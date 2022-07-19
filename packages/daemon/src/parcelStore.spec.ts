import {
  Certificate,
  generateRSAKeyPair,
  issueDeliveryAuthorization,
  issueEndpointCertificate,
  Parcel,
  ParcelCollectionAck,
} from '@relaycorp/relaynet-core';
import { deserialize, Document, serialize } from 'bson';
import { subSeconds } from 'date-fns';
import { promises as fs } from 'fs';
import pipe from 'it-pipe';
import { join } from 'path';
import { PassThrough } from 'stream';
import { Container } from 'typedi';

import { ParcelCollection } from './entity/ParcelCollection';
import { FileStore } from './fileStore';
import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import { ParcelStore, ParcelWithExpiryDate } from './parcelStore';
import { CourierSyncManager } from './sync/courierSync/CourierSyncManager';
import { ParcelCollectorManager } from './sync/publicGateway/parcelCollection/ParcelCollectorManager';
import { useTemporaryAppDirs } from './testUtils/appDirs';
import { generatePKIFixture, mockGatewayRegistration, sha256Hex } from './testUtils/crypto';
import { setUpTestDBConnection } from './testUtils/db';
import { arrayToAsyncIterable, asyncIterableToArray, iterableTake } from './testUtils/iterables';
import { getMockInstance, mockSpy } from './testUtils/jest';
import { mockLoggerToken, partialPinoLog } from './testUtils/logging';
import { GeneratedParcel } from './testUtils/ramf';
import { LOGGER } from './tokens';
import { MessageDirection } from './utils/MessageDirection';

const getConnection = setUpTestDBConnection();

const getAppDirs = useTemporaryAppDirs();

const mockLogs = mockLoggerToken();

let localEndpointPrivateKey: CryptoKey;
let localEndpointCertificate: Certificate;
let remoteEndpointPrivateKey: CryptoKey;
let remoteEndpointCertificate: Certificate;
let gatewayPrivateKey: CryptoKey;
let gatewayCertificate: Certificate;
const pkiFixtureRetriever = generatePKIFixture((keyPairSet, certPath) => {
  localEndpointPrivateKey = keyPairSet.privateEndpoint.privateKey;
  localEndpointCertificate = certPath.privateEndpoint;

  remoteEndpointPrivateKey = keyPairSet.pdaGrantee.privateKey;
  remoteEndpointCertificate = certPath.pdaGrantee;

  gatewayPrivateKey = keyPairSet.privateGateway.privateKey;
  gatewayCertificate = certPath.privateGateway;
});
mockGatewayRegistration(pkiFixtureRetriever);

let parcelStore: ParcelStore;
beforeEach(() => {
  parcelStore = new ParcelStore(
    Container.get(FileStore),
    Container.get(DBPrivateKeyStore),
    getConnection().getRepository(ParcelCollection),
    Container.get(LOGGER),
  );
});

const PUBLIC_ENDPOINT_ADDRESS = 'https://endpoint.com';

describe('storeInternetBound', () => {
  test('Parcel should be stored', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();

    await parcelStore.storeInternetBound(parcelSerialized, parcel);

    const expectedParcelPath = await computeInternetBoundParcelPath(parcel);
    const parcelFile = await fs.readFile(expectedParcelPath);
    expect(parcelFile).toEqual(parcelSerialized);
  });

  test('Stored parcel key should be output', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();

    const key = await parcelStore.storeInternetBound(parcelSerialized, parcel);

    expect(key).toEqual(await computeInternetBoundParcelKey(parcel));
  });

  test('Parcel expiry date should be stored in metadata file', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    await parcelStore.storeInternetBound(parcelSerialized, parcel);

    const parcelPath = await computeInternetBoundParcelPath(parcel);
    const parcelMetadataPath = parcelPath + '.pmeta';
    const parcelMetadata = deserialize(await fs.readFile(parcelMetadataPath));
    expect(parcelMetadata).toHaveProperty('expiryDate', parcel.expiryDate.getTime() / 1_000);
  });
});

describe('storeEndpointBound', () => {
  test('Parcel should be stored if it had not been stored previously', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();

    await parcelStore.storeEndpointBound(parcelSerialized, parcel);

    const expectedParcelPath = await computeEndpointBoundParcelPath(parcel);
    const parcelFile = await fs.readFile(expectedParcelPath);
    expect(parcelFile).toEqual(parcelSerialized);
  });

  test('Parcel should be overridden if it was stored but has not been delivered to endpoint', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    await parcelStore.storeEndpointBound(parcelSerialized, parcel);
    const collectionRepo = getConnection().getRepository(ParcelCollection);
    await collectionRepo.save(
      collectionRepo.create({
        parcelExpiryDate: parcel.expiryDate,
        parcelId: parcel.id,
        recipientEndpointAddress: parcel.recipientAddress,
        senderEndpointPrivateAddress:
          await parcel.senderCertificate.calculateSubjectPrivateAddress(),
      }),
    );
    const parcelV2Serialized = Buffer.from('Version 2');

    await expect(parcelStore.storeEndpointBound(parcelV2Serialized, parcel)).resolves.toBeNull();

    const expectedParcelPath = await computeEndpointBoundParcelPath(parcel);
    await expect(fs.readFile(expectedParcelPath)).resolves.toEqual(parcelV2Serialized);
  });

  test('Parcel should be ignored if it was already stored and delivered to endpoint', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    const collectionRepo = getConnection().getRepository(ParcelCollection);
    await collectionRepo.save(
      collectionRepo.create({
        parcelExpiryDate: parcel.expiryDate,
        parcelId: parcel.id,
        recipientEndpointAddress: parcel.recipientAddress,
        senderEndpointPrivateAddress:
          await parcel.senderCertificate.calculateSubjectPrivateAddress(),
      }),
    );

    await expect(parcelStore.storeEndpointBound(parcelSerialized, parcel)).resolves.toBeNull();

    const expectedParcelPath = await computeEndpointBoundParcelPath(parcel);
    await expect(fs.readFile(expectedParcelPath)).toReject();
  });

  test('Stored parcel key should be output', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();

    const key = await parcelStore.storeEndpointBound(parcelSerialized, parcel);

    expect(key).toEqual(await computeEndpointBoundParcelKey(parcel));
  });

  test('Parcel expiry date should be stored in metadata file', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    await parcelStore.storeEndpointBound(parcelSerialized, parcel);

    const parcelPath = await computeEndpointBoundParcelPath(parcel);
    const parcelMetadataPath = parcelPath + '.pmeta';
    const parcelMetadata = deserialize(await fs.readFile(parcelMetadataPath));
    expect(parcelMetadata).toHaveProperty('expiryDate', parcel.expiryDate.getTime() / 1_000);
  });

  test('Metadata should be stored before parcel', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    const fileStore = Container.get(FileStore);
    const fileStorePutSpy = jest.spyOn(fileStore, 'putObject');

    try {
      await parcelStore.storeEndpointBound(parcelSerialized, parcel);

      expect(fileStorePutSpy).toBeCalledTimes(2);
      expect(fileStorePutSpy).nthCalledWith(1, expect.anything(), expect.toEndWith('.pmeta'));
    } finally {
      fileStorePutSpy.mockRestore();
    }
  });
});

describe('listInternetBound', () => {
  test('No parcels should be output if there are none', async () => {
    await expect(asyncIterableToArray(parcelStore.listInternetBound())).resolves.toHaveLength(0);
  });

  test('Expired parcels should be skipped and deleted', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.storeInternetBound(parcelSerialized, parcel);
    // Override the metadata to mark the parcel as expired
    const expiryDate = subSeconds(new Date(), 1);
    await overrideMetadataFile({ expiryDate }, parcel, MessageDirection.TOWARDS_INTERNET);

    await expect(asyncIterableToArray(parcelStore.listInternetBound())).resolves.toHaveLength(0);

    await expect(parcelStore.retrieve(key, MessageDirection.TOWARDS_INTERNET)).resolves.toBeNull();
  });

  test('Parcel should be output when requested', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeInternetBoundParcel();
    await parcelStore.storeInternetBound(parcel1Serialized, parcel1);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } =
      await makeInternetBoundParcel();
    await parcelStore.storeInternetBound(parcel2Serialized, parcel2);

    const parcelObjects = await asyncIterableToArray(parcelStore.listInternetBound());

    expect(parcelObjects).toHaveLength(2);
    expect(parcelObjects).toContainEqual<ParcelWithExpiryDate>({
      expiryDate: parcel1.expiryDate,
      parcelKey: await computeInternetBoundParcelKey(parcel1),
    });
    expect(parcelObjects).toContainEqual<ParcelWithExpiryDate>({
      expiryDate: parcel2.expiryDate,
      parcelKey: await computeInternetBoundParcelKey(parcel2),
    });
  });

  describe('Invalid metadata file', () => {
    test('Parcel with missing metadata file should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
      await fs.unlink((await computeInternetBoundParcelPath(parcel)) + '.pmeta');

      await expect(asyncIterableToArray(parcelStore.listInternetBound())).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, MessageDirection.TOWARDS_INTERNET),
      ).resolves.toBeNull();
      expect(mockLogs).toContainEqual(
        partialPinoLog('warn', 'Failed to find parcel metadata file', {
          parcelKey,
        }),
      );
    });

    test('Parcel with malformed metadata should be ignored and delete', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
      await overrideMetadataFile(
        Buffer.from('malformed'),
        parcel,
        MessageDirection.TOWARDS_INTERNET,
      );

      await expect(asyncIterableToArray(parcelStore.listInternetBound())).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, MessageDirection.TOWARDS_INTERNET),
      ).resolves.toBeNull();
      expect(mockLogs).toContainEqual(
        partialPinoLog('warn', 'Malformed parcel metadata file', {
          err: expect.objectContaining({ type: 'BSONError' }),
          parcelKey,
        }),
      );
    });

    test('Parcel without expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
      await overrideMetadataFile({}, parcel, MessageDirection.TOWARDS_INTERNET);

      await expect(asyncIterableToArray(parcelStore.listInternetBound())).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, MessageDirection.TOWARDS_INTERNET),
      ).resolves.toBeNull();
      expect(mockLogs).toContainEqual(
        partialPinoLog('warn', 'Parcel metadata does not have a (valid) expiry date', {
          parcelKey,
        }),
      );
    });

    test('Parcel with malformed expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
      const expiryDate = 'tomorrow';
      await overrideMetadataFile({ expiryDate }, parcel, MessageDirection.TOWARDS_INTERNET);

      await expect(asyncIterableToArray(parcelStore.listInternetBound())).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, MessageDirection.TOWARDS_INTERNET),
      ).resolves.toBeNull();
      expect(mockLogs).toContainEqual(
        partialPinoLog('warn', 'Parcel metadata does not have a (valid) expiry date', {
          expiryDate,
          parcelKey,
        }),
      );
    });
  });
});

describe('streamEndpointBound', () => {
  let localEndpoint1Address: string;
  let localEndpoint2Certificate: Certificate;
  let remoteEndpointPDA2: Certificate;
  beforeEach(async () => {
    localEndpoint1Address = await localEndpointCertificate.calculateSubjectPrivateAddress();

    const localEndpoint2KeyPair = await generateRSAKeyPair();
    localEndpoint2Certificate = await issueEndpointCertificate({
      issuerCertificate: gatewayCertificate,
      issuerPrivateKey: gatewayPrivateKey,
      subjectPublicKey: localEndpoint2KeyPair.publicKey,
      validityEndDate: gatewayCertificate.expiryDate,
    });
    remoteEndpointPDA2 = await issueDeliveryAuthorization({
      issuerCertificate: localEndpoint2Certificate,
      issuerPrivateKey: localEndpoint2KeyPair.privateKey,
      subjectPublicKey: await remoteEndpointCertificate.getPublicKey(),
      validityEndDate: localEndpoint2Certificate.expiryDate,
    });
  });

  const mockParcelCollectorManagerWatch = mockSpy(
    jest.spyOn(ParcelCollectorManager.prototype, 'watchCollectionsForRecipients'),
    () => arrayToAsyncIterable([]),
  );
  const mockCourierSyncManagerStream = mockSpy(
    jest.spyOn(CourierSyncManager.prototype, 'streamCollectedParcelKeys'),
    () => arrayToAsyncIterable([]),
  );

  test('No parcels should be output if there are none', async () => {
    await expect(
      asyncIterableToArray(parcelStore.streamEndpointBound([localEndpoint1Address], true)),
    ).resolves.toHaveLength(0);
  });

  test('Expired parcels should be skipped and deleted', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    const key = await parcelStore.storeEndpointBound(parcelSerialized, parcel);
    // Override the metadata to mark the parcel as expired
    const expiryDate = subSeconds(new Date(), 1);
    await overrideMetadataFile({ expiryDate }, parcel, MessageDirection.FROM_INTERNET);

    await expect(
      asyncIterableToArray(parcelStore.streamEndpointBound([localEndpoint1Address], true)),
    ).resolves.toHaveLength(0);

    await expect(parcelStore.retrieve(key!, MessageDirection.FROM_INTERNET)).resolves.toBeNull();
  });

  test('Parcel should be output when requested', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.storeEndpointBound(parcel1Serialized, parcel1);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.storeEndpointBound(parcel2Serialized, parcel2);

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamEndpointBound([localEndpoint1Address], true),
    );

    expect(parcelObjects).toHaveLength(2);
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel1));
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel2));
  });

  test('Multiple recipients can be queried', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.storeEndpointBound(parcel1Serialized, parcel1);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } = await makeEndpointBoundParcel(
      localEndpoint2Certificate,
      remoteEndpointPDA2,
      remoteEndpointPrivateKey,
    );
    await parcelStore.storeEndpointBound(parcel2Serialized, parcel2);

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamEndpointBound(
        [localEndpoint1Address, await localEndpoint2Certificate.calculateSubjectPrivateAddress()],
        true,
      ),
    );

    expect(parcelObjects).toHaveLength(2);
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel1));
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel2));
  });

  test('Parcels bound for different endpoints should be ignored', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.storeEndpointBound(parcel1Serialized, parcel1);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } = await makeEndpointBoundParcel(
      localEndpoint2Certificate,
      remoteEndpointPDA2,
      remoteEndpointPrivateKey,
    );
    await parcelStore.storeEndpointBound(parcel2Serialized, parcel2);

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamEndpointBound([localEndpoint1Address], true),
    );

    expect(parcelObjects).toHaveLength(1);
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel1));
  });

  test('Endpoint addresses should be deduped', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.storeEndpointBound(parcel1Serialized, parcel1);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.storeEndpointBound(parcel2Serialized, parcel2);

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamEndpointBound([localEndpoint1Address, localEndpoint1Address], false),
    );

    expect(parcelObjects).toHaveLength(2);
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel1));
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel2));
  });

  test('New parcels should be ignored if keep alive is off', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.storeEndpointBound(parcel1Serialized, parcel1);
    mockParcelCollectorManagerWatch.mockReturnValueOnce(arrayToAsyncIterable(['parcel2']));

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamEndpointBound([localEndpoint1Address], false),
    );

    expect(parcelObjects).toEqual([await computeEndpointBoundParcelKey(parcel1)]);
    expect(mockParcelCollectorManagerWatch).not.toBeCalled();
  });

  describe('Keep alive on', () => {
    test.each([
      ['Internet', mockParcelCollectorManagerWatch],
      ['courier', mockCourierSyncManagerStream],
    ])('New parcels via %s should be output after queued ones', async (_, mock) => {
      const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
        await makeEndpointBoundParcel();
      await parcelStore.storeEndpointBound(parcel1Serialized, parcel1);
      const parcel2Key = 'parcel2';
      mock.mockReturnValueOnce(arrayToAsyncIterable([parcel2Key]));

      const parcelObjects = await asyncIterableToArray(
        parcelStore.streamEndpointBound([localEndpoint1Address], true),
      );

      expect(parcelObjects).toEqual([await computeEndpointBoundParcelKey(parcel1), parcel2Key]);
      expect(mock).toBeCalledWith([localEndpoint1Address]);
    });

    test('Parcels from Internet and courier should be output in order received', async () => {
      const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
        await makeEndpointBoundParcel();
      await parcelStore.storeEndpointBound(parcel1Serialized, parcel1);
      const internetStream = new PassThrough({ objectMode: true });
      mockParcelCollectorManagerWatch.mockReturnValueOnce(internetStream);
      const courierStream = new PassThrough({ objectMode: true });
      mockCourierSyncManagerStream.mockReturnValueOnce(courierStream);
      const internetParcel1 = 'parcel 1 via Internet';
      const internetParcel2 = 'parcel 2 via Internet';
      const courierParcel1 = 'parcel 1 via courier';
      const courierParcel2 = 'parcel 2 via courier';

      setImmediate(() => {
        internetStream.write(internetParcel1);
        internetStream.write(courierParcel1);
        internetStream.write(internetParcel2);
        internetStream.write(courierParcel2);
      });
      const parcelObjects = await pipe(
        parcelStore.streamEndpointBound([localEndpoint1Address], true),
        iterableTake(5),
        asyncIterableToArray,
      );

      expect(parcelObjects).toEqual([
        await computeEndpointBoundParcelKey(parcel1),
        internetParcel1,
        courierParcel1,
        internetParcel2,
        courierParcel2,
      ]);
      expect(mockCourierSyncManagerStream).toBeCalledWith([localEndpoint1Address]);
    });
  });

  describe('Invalid metadata file', () => {
    test('Parcel with missing metadata file should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
      const parcelKey = await parcelStore.storeEndpointBound(parcelSerialized, parcel);
      await fs.unlink((await computeEndpointBoundParcelPath(parcel)) + '.pmeta');

      await expect(
        asyncIterableToArray(parcelStore.streamEndpointBound([localEndpoint1Address], true)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey!, MessageDirection.FROM_INTERNET),
      ).resolves.toBeNull();
      expect(mockLogs).toContainEqual(
        partialPinoLog('warn', 'Failed to find parcel metadata file', {
          parcelKey,
        }),
      );
    });

    test('Parcel with malformed metadata should be ignored and delete', async () => {
      const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
      const parcelKey = await parcelStore.storeEndpointBound(parcelSerialized, parcel);
      await overrideMetadataFile(Buffer.from('malformed'), parcel, MessageDirection.FROM_INTERNET);

      await expect(
        asyncIterableToArray(parcelStore.streamEndpointBound([localEndpoint1Address], true)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey!, MessageDirection.FROM_INTERNET),
      ).resolves.toBeNull();
      expect(mockLogs).toContainEqual(
        partialPinoLog('warn', 'Malformed parcel metadata file', {
          parcelKey,
        }),
      );
    });

    test('Parcel without expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
      const parcelKey = await parcelStore.storeEndpointBound(parcelSerialized, parcel);
      await overrideMetadataFile({}, parcel, MessageDirection.FROM_INTERNET);

      await expect(
        asyncIterableToArray(parcelStore.streamEndpointBound([localEndpoint1Address], true)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey!, MessageDirection.FROM_INTERNET),
      ).resolves.toBeNull();
      expect(mockLogs).toContainEqual(
        partialPinoLog('warn', 'Parcel metadata does not have a (valid) expiry date', {
          parcelKey,
        }),
      );
    });

    test('Parcel with malformed expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
      const parcelKey = await parcelStore.storeEndpointBound(parcelSerialized, parcel);
      const expiryDate = 'tomorrow';
      await overrideMetadataFile({ expiryDate }, parcel, MessageDirection.FROM_INTERNET);

      await expect(
        asyncIterableToArray(parcelStore.streamEndpointBound([localEndpoint1Address], true)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey!, MessageDirection.FROM_INTERNET),
      ).resolves.toBeNull();
      expect(mockLogs).toContainEqual(
        partialPinoLog('warn', 'Parcel metadata does not have a (valid) expiry date', {
          expiryDate,
          parcelKey,
        }),
      );
    });
  });
});

describe('retrieve', () => {
  test('Nothing should be output if parcel does not exist', async () => {
    await expect(
      parcelStore.retrieve('non-existing', MessageDirection.TOWARDS_INTERNET),
    ).resolves.toBeNull();
  });

  test('Internet-bound parcel should be output if it exists', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.storeInternetBound(parcelSerialized, parcel);

    await expect(parcelStore.retrieve(key, MessageDirection.TOWARDS_INTERNET)).resolves.toEqual(
      parcelSerialized,
    );
  });

  test('Endpoint-bound parcel should be output if it exists', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    const key = await parcelStore.storeEndpointBound(parcelSerialized, parcel);

    await expect(parcelStore.retrieve(key!, MessageDirection.FROM_INTERNET)).resolves.toEqual(
      parcelSerialized,
    );
  });
});

describe('delete', () => {
  test('Non-existing parcel should be ignored', async () => {
    await parcelStore.delete('non-existing', MessageDirection.TOWARDS_INTERNET);
  });

  test('Internet-bound parcel should be deleted if it exists', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.storeInternetBound(parcelSerialized, parcel);

    await parcelStore.delete(key, MessageDirection.TOWARDS_INTERNET);

    await expect(parcelStore.retrieve(key, MessageDirection.TOWARDS_INTERNET)).resolves.toBeNull();
  });

  test('Endpoint-bound parcel should be deleted if it exists', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    const key = await parcelStore.storeEndpointBound(parcelSerialized, parcel);

    await parcelStore.delete(key!, MessageDirection.FROM_INTERNET);

    await expect(parcelStore.retrieve(key!, MessageDirection.FROM_INTERNET)).resolves.toBeNull();
  });

  test('Parcel metadata file should be deleted', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.storeInternetBound(parcelSerialized, parcel);
    const parcelMetadataPath = (await computeInternetBoundParcelPath(parcel)) + '.pmeta';
    await expect(fs.stat(parcelMetadataPath)).toResolve(); // Check that we got the right path

    await parcelStore.delete(key, MessageDirection.TOWARDS_INTERNET);

    await expect(fs.stat(parcelMetadataPath)).toReject();
  });
});

describe('deleteInternetBoundFromACK', () => {
  beforeEach(() => {
    jest.spyOn(parcelStore, 'delete').mockReset();
  });
  afterEach(() => {
    getMockInstance(parcelStore.delete).mockRestore();
  });

  test('Existing parcel should be deleted', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
    const ack = new ParcelCollectionAck(
      await parcel.senderCertificate.calculateSubjectPrivateAddress(),
      parcel.recipientAddress,
      parcel.id,
    );

    await parcelStore.deleteInternetBoundFromACK(ack);

    expect(parcelStore.delete).toBeCalledWith(parcelKey, MessageDirection.TOWARDS_INTERNET);
  });

  test('ACK should be ignored if sender address is malformed', async () => {
    const { parcel } = await makeInternetBoundParcel();
    const ack = new ParcelCollectionAck('..', parcel.recipientAddress, parcel.id);

    await parcelStore.deleteInternetBoundFromACK(ack);

    expect(parcelStore.delete).not.toBeCalled();
  });

  test('ACK should be ignored if parcel id is malformed', async () => {
    const { parcel } = await makeInternetBoundParcel();
    const ack = new ParcelCollectionAck(
      await parcel.senderCertificate.calculateSubjectPrivateAddress(),
      parcel.recipientAddress,
      '..',
    );

    await parcelStore.deleteInternetBoundFromACK(ack);

    expect(parcelStore.delete).not.toBeCalled();
  });
});

async function makeInternetBoundParcel(): Promise<GeneratedParcel> {
  const parcel = new Parcel(PUBLIC_ENDPOINT_ADDRESS, localEndpointCertificate, Buffer.from([]));
  const parcelSerialized = Buffer.from(await parcel.serialize(localEndpointPrivateKey));
  return { parcel, parcelSerialized };
}

async function makeEndpointBoundParcel(
  recipientCertificate?: Certificate,
  senderCertificate?: Certificate,
  senderPrivateKey?: CryptoKey,
): Promise<GeneratedParcel> {
  const finalRecipientCertificate = recipientCertificate ?? localEndpointCertificate;
  const parcel = new Parcel(
    await finalRecipientCertificate.calculateSubjectPrivateAddress(),
    senderCertificate ?? remoteEndpointCertificate,
    Buffer.from([]),
    { senderCaCertificateChain: [gatewayCertificate, finalRecipientCertificate] },
  );
  const parcelSerialized = Buffer.from(
    await parcel.serialize(senderPrivateKey ?? remoteEndpointPrivateKey),
  );
  return { parcel, parcelSerialized };
}

async function computeInternetBoundParcelPath(parcel: Parcel): Promise<string> {
  return join(
    getAppDirs().data,
    'parcels',
    'internet-bound',
    await computeInternetBoundParcelKey(parcel),
  );
}

async function computeInternetBoundParcelKey(parcel: Parcel): Promise<string> {
  return join(
    await parcel.senderCertificate.calculateSubjectPrivateAddress(),
    sha256Hex(parcel.recipientAddress + parcel.id),
  );
}

async function computeEndpointBoundParcelPath(parcel: Parcel): Promise<string> {
  return join(
    getAppDirs().data,
    'parcels',
    'endpoint-bound',
    await computeEndpointBoundParcelKey(parcel),
  );
}

async function computeEndpointBoundParcelKey(parcel: Parcel): Promise<string> {
  const senderPrivateAddress = await parcel.senderCertificate.calculateSubjectPrivateAddress();
  return join(parcel.recipientAddress, sha256Hex(senderPrivateAddress + parcel.id));
}

async function overrideMetadataFile(
  metadata: Document | Buffer,
  parcel: Parcel,
  direction: MessageDirection,
): Promise<void> {
  const pathCalculator =
    direction === MessageDirection.TOWARDS_INTERNET
      ? computeInternetBoundParcelPath
      : computeEndpointBoundParcelPath;
  const metadataPath = (await pathCalculator(parcel)) + '.pmeta';
  await expect(fs.stat(metadataPath)).toResolve();
  const metadataSerialized = Buffer.isBuffer(metadata) ? metadata : serialize(metadata);
  await fs.writeFile(metadataPath, metadataSerialized);
}
