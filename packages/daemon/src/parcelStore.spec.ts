import {
  Certificate,
  generateRSAKeyPair,
  issueDeliveryAuthorization,
  issueEndpointCertificate,
  Parcel,
} from '@relaycorp/relaynet-core';
import { deserialize, Document, serialize } from 'bson';
import { subSeconds } from 'date-fns';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';

import { ParcelCollection } from './entity/ParcelCollection';
import { FileStore } from './fileStore';
import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import { ParcelStore, ParcelWithExpiryDate } from './parcelStore';
import { ParcelCollectorManager } from './sync/publicGateway/parcelCollection/ParcelCollectorManager';
import { useTemporaryAppDirs } from './testUtils/appDirs';
import { generatePKIFixture, mockGatewayRegistration, sha256Hex } from './testUtils/crypto';
import { setUpTestDBConnection } from './testUtils/db';
import { arrayToAsyncIterable, asyncIterableToArray } from './testUtils/iterables';
import { mockSpy } from './testUtils/jest';
import { mockLoggerToken } from './testUtils/logging';
import { GeneratedParcel } from './testUtils/ramf';
import { MessageDirection } from './utils/MessageDirection';

setUpTestDBConnection();

const getAppDirs = useTemporaryAppDirs();

mockLoggerToken();

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
  parcelStore = new ParcelStore(Container.get(FileStore), Container.get(DBPrivateKeyStore));
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
    const collectionRepo = getRepository(ParcelCollection);
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
    const collectionRepo = getRepository(ParcelCollection);
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
    });

    test('Parcel without expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
      await overrideMetadataFile({}, parcel, MessageDirection.TOWARDS_INTERNET);

      await expect(asyncIterableToArray(parcelStore.listInternetBound())).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, MessageDirection.TOWARDS_INTERNET),
      ).resolves.toBeNull();
    });

    test('Parcel with malformed expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
      await overrideMetadataFile(
        { expiryDate: 'tomorrow' },
        parcel,
        MessageDirection.TOWARDS_INTERNET,
      );

      await expect(asyncIterableToArray(parcelStore.listInternetBound())).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, MessageDirection.TOWARDS_INTERNET),
      ).resolves.toBeNull();
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

  test('New parcels should be output after queued ones if keep alive is on', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.storeEndpointBound(parcel1Serialized, parcel1);
    const parcel2Key = 'parcel2';
    mockParcelCollectorManagerWatch.mockReturnValueOnce(arrayToAsyncIterable([parcel2Key]));

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamEndpointBound([localEndpoint1Address], true),
    );

    expect(parcelObjects).toEqual([await computeEndpointBoundParcelKey(parcel1), parcel2Key]);
    expect(mockParcelCollectorManagerWatch).toBeCalledWith([localEndpoint1Address]);
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
    });

    test('Parcel with malformed expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
      const parcelKey = await parcelStore.storeEndpointBound(parcelSerialized, parcel);
      await overrideMetadataFile(
        { expiryDate: 'tomorrow' },
        parcel,
        MessageDirection.FROM_INTERNET,
      );

      await expect(
        asyncIterableToArray(parcelStore.streamEndpointBound([localEndpoint1Address], true)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey!, MessageDirection.FROM_INTERNET),
      ).resolves.toBeNull();
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
    await sha256Hex(parcel.recipientAddress + parcel.id),
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
  return join(parcel.recipientAddress, await sha256Hex(senderPrivateAddress + parcel.id));
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
