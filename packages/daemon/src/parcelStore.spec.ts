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

import { FileStore } from './fileStore';
import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import { ParcelDirection, ParcelStore } from './parcelStore';
import { ParcelCollectorManager } from './sync/publicGateway/parcelCollection/ParcelCollectorManager';
import { useTemporaryAppDirs } from './testUtils/appDirs';
import { setUpPKIFixture, sha256Hex } from './testUtils/crypto';
import { setUpTestDBConnection } from './testUtils/db';
import { arrayToAsyncIterable, asyncIterableToArray } from './testUtils/iterables';
import { mockSpy } from './testUtils/jest';
import { mockLoggerToken } from './testUtils/logging';
import { GeneratedParcel } from './testUtils/ramf';

setUpTestDBConnection();

const getAppDirs = useTemporaryAppDirs();

mockLoggerToken();

let localEndpointPrivateKey: CryptoKey;
let localEndpointCertificate: Certificate;
let remoteEndpointPrivateKey: CryptoKey;
let remoteEndpointCertificate: Certificate;
let gatewayPrivateKey: CryptoKey;
let gatewayCertificate: Certificate;
setUpPKIFixture((keyPairSet, certPath) => {
  localEndpointPrivateKey = keyPairSet.privateEndpoint.privateKey;
  localEndpointCertificate = certPath.privateEndpoint;

  remoteEndpointPrivateKey = keyPairSet.pdaGrantee.privateKey;
  remoteEndpointCertificate = certPath.pdaGrantee;

  gatewayPrivateKey = keyPairSet.privateGateway.privateKey;
  gatewayCertificate = certPath.privateGateway;
});

beforeEach(async () => {
  const privateKeyStore = Container.get(DBPrivateKeyStore);
  await privateKeyStore.saveNodeKey(gatewayPrivateKey, gatewayCertificate);
});

let parcelStore: ParcelStore;
beforeEach(() => {
  parcelStore = new ParcelStore(Container.get(FileStore), Container.get(DBPrivateKeyStore));
});

const PUBLIC_ENDPOINT_ADDRESS = 'https://endpoint.com';

describe('store', () => {
  test('Internet-bound parcels should be stored', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();

    await parcelStore.store(parcelSerialized, parcel, ParcelDirection.ENDPOINT_TO_INTERNET);

    const expectedParcelPath = await computeInternetBoundParcelPath(parcel);
    const parcelFile = await fs.readFile(expectedParcelPath);
    expect(parcelFile).toEqual(parcelSerialized);
  });

  test('Endpoint-bound parcels should be stored', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();

    await parcelStore.store(parcelSerialized, parcel, ParcelDirection.INTERNET_TO_ENDPOINT);

    const expectedParcelPath = await computeEndpointBoundParcelPath(parcel);
    const parcelFile = await fs.readFile(expectedParcelPath);
    expect(parcelFile).toEqual(parcelSerialized);
  });

  test('Stored parcel key should be output', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();

    const key = await parcelStore.store(
      parcelSerialized,
      parcel,
      ParcelDirection.ENDPOINT_TO_INTERNET,
    );

    expect(key).toEqual(await computeInternetBoundParcelKey(parcel));
  });

  test('Parcel expiry date should be stored in metadata file', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    await parcelStore.store(parcelSerialized, parcel, ParcelDirection.ENDPOINT_TO_INTERNET);

    const parcelPath = await computeInternetBoundParcelPath(parcel);
    const parcelMetadataPath = parcelPath + '.pmeta';
    const parcelMetadata = deserialize(await fs.readFile(parcelMetadataPath));
    expect(parcelMetadata).toHaveProperty('expiryDate', parcel.expiryDate.getTime() / 1_000);
  });
});

describe('listActiveBoundForInternet', () => {
  test('No parcels should be output if there are none', async () => {
    await expect(
      asyncIterableToArray(parcelStore.listActiveBoundForInternet()),
    ).resolves.toHaveLength(0);
  });

  test('Expired parcels should be skipped and deleted', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.store(
      parcelSerialized,
      parcel,
      ParcelDirection.ENDPOINT_TO_INTERNET,
    );
    // Override the metadata to mark the parcel as expired
    const expiryDate = subSeconds(new Date(), 1);
    await overrideMetadataFile({ expiryDate }, parcel, ParcelDirection.ENDPOINT_TO_INTERNET);

    await expect(
      asyncIterableToArray(parcelStore.listActiveBoundForInternet()),
    ).resolves.toHaveLength(0);

    await expect(
      parcelStore.retrieve(key, ParcelDirection.ENDPOINT_TO_INTERNET),
    ).resolves.toBeNull();
  });

  test('Parcel should be output when requested', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeInternetBoundParcel();
    await parcelStore.store(parcel1Serialized, parcel1, ParcelDirection.ENDPOINT_TO_INTERNET);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } =
      await makeInternetBoundParcel();
    await parcelStore.store(parcel2Serialized, parcel2, ParcelDirection.ENDPOINT_TO_INTERNET);

    const parcelObjects = await asyncIterableToArray(parcelStore.listActiveBoundForInternet());

    expect(parcelObjects).toHaveLength(2);
    expect(parcelObjects).toContain(await computeInternetBoundParcelKey(parcel1));
    expect(parcelObjects).toContain(await computeInternetBoundParcelKey(parcel2));
  });

  describe('Invalid metadata file', () => {
    test('Parcel with missing metadata file should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        parcel,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );
      await fs.unlink((await computeInternetBoundParcelPath(parcel)) + '.pmeta');

      await expect(asyncIterableToArray(parcelStore.listActiveBoundForInternet())).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.ENDPOINT_TO_INTERNET),
      ).resolves.toBeNull();
    });

    test('Parcel with malformed metadata should be ignored and delete', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        parcel,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );
      await overrideMetadataFile(
        Buffer.from('malformed'),
        parcel,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );

      await expect(asyncIterableToArray(parcelStore.listActiveBoundForInternet())).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.ENDPOINT_TO_INTERNET),
      ).resolves.toBeNull();
    });

    test('Parcel without expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        parcel,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );
      await overrideMetadataFile({}, parcel, ParcelDirection.ENDPOINT_TO_INTERNET);

      await expect(asyncIterableToArray(parcelStore.listActiveBoundForInternet())).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.ENDPOINT_TO_INTERNET),
      ).resolves.toBeNull();
    });

    test('Parcel with malformed expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        parcel,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );
      await overrideMetadataFile(
        { expiryDate: 'tomorrow' },
        parcel,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );

      await expect(asyncIterableToArray(parcelStore.listActiveBoundForInternet())).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.ENDPOINT_TO_INTERNET),
      ).resolves.toBeNull();
    });
  });
});

describe('streamActiveBoundForEndpoints', () => {
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
      asyncIterableToArray(
        parcelStore.streamActiveBoundForEndpoints([localEndpoint1Address], true),
      ),
    ).resolves.toHaveLength(0);
  });

  test('Expired parcels should be skipped and deleted', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    const key = await parcelStore.store(
      parcelSerialized,
      parcel,
      ParcelDirection.INTERNET_TO_ENDPOINT,
    );
    // Override the metadata to mark the parcel as expired
    const expiryDate = subSeconds(new Date(), 1);
    await overrideMetadataFile({ expiryDate }, parcel, ParcelDirection.INTERNET_TO_ENDPOINT);

    await expect(
      asyncIterableToArray(
        parcelStore.streamActiveBoundForEndpoints([localEndpoint1Address], true),
      ),
    ).resolves.toHaveLength(0);

    await expect(
      parcelStore.retrieve(key, ParcelDirection.INTERNET_TO_ENDPOINT),
    ).resolves.toBeNull();
  });

  test('Parcel should be output when requested', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.store(parcel1Serialized, parcel1, ParcelDirection.INTERNET_TO_ENDPOINT);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.store(parcel2Serialized, parcel2, ParcelDirection.INTERNET_TO_ENDPOINT);

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamActiveBoundForEndpoints([localEndpoint1Address], true),
    );

    expect(parcelObjects).toHaveLength(2);
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel1));
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel2));
  });

  test('Multiple recipients can be queried', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.store(parcel1Serialized, parcel1, ParcelDirection.INTERNET_TO_ENDPOINT);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } = await makeEndpointBoundParcel(
      localEndpoint2Certificate,
      remoteEndpointPDA2,
      remoteEndpointPrivateKey,
    );
    await parcelStore.store(parcel2Serialized, parcel2, ParcelDirection.INTERNET_TO_ENDPOINT);

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamActiveBoundForEndpoints(
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
    await parcelStore.store(parcel1Serialized, parcel1, ParcelDirection.INTERNET_TO_ENDPOINT);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } = await makeEndpointBoundParcel(
      localEndpoint2Certificate,
      remoteEndpointPDA2,
      remoteEndpointPrivateKey,
    );
    await parcelStore.store(parcel2Serialized, parcel2, ParcelDirection.INTERNET_TO_ENDPOINT);

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamActiveBoundForEndpoints([localEndpoint1Address], true),
    );

    expect(parcelObjects).toHaveLength(1);
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel1));
  });

  test('New parcels should be output after queued ones if keep alive is on', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.store(parcel1Serialized, parcel1, ParcelDirection.INTERNET_TO_ENDPOINT);
    const parcel2Key = 'parcel2';
    mockParcelCollectorManagerWatch.mockReturnValueOnce(arrayToAsyncIterable([parcel2Key]));

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamActiveBoundForEndpoints([localEndpoint1Address], true),
    );

    expect(parcelObjects).toEqual([await computeEndpointBoundParcelKey(parcel1), parcel2Key]);
    expect(mockParcelCollectorManagerWatch).toBeCalledWith([localEndpoint1Address]);
  });

  test('New parcels should be ignored if keep alive is off', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.store(parcel1Serialized, parcel1, ParcelDirection.INTERNET_TO_ENDPOINT);
    mockParcelCollectorManagerWatch.mockReturnValueOnce(arrayToAsyncIterable(['parcel2']));

    const parcelObjects = await asyncIterableToArray(
      parcelStore.streamActiveBoundForEndpoints([localEndpoint1Address], false),
    );

    expect(parcelObjects).toEqual([await computeEndpointBoundParcelKey(parcel1)]);
    expect(mockParcelCollectorManagerWatch).not.toBeCalled();
  });

  describe('Invalid metadata file', () => {
    test('Parcel with missing metadata file should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        parcel,
        ParcelDirection.INTERNET_TO_ENDPOINT,
      );
      await fs.unlink((await computeEndpointBoundParcelPath(parcel)) + '.pmeta');

      await expect(
        asyncIterableToArray(
          parcelStore.streamActiveBoundForEndpoints([localEndpoint1Address], true),
        ),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.INTERNET_TO_ENDPOINT),
      ).resolves.toBeNull();
    });

    test('Parcel with malformed metadata should be ignored and delete', async () => {
      const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        parcel,
        ParcelDirection.INTERNET_TO_ENDPOINT,
      );
      await overrideMetadataFile(
        Buffer.from('malformed'),
        parcel,
        ParcelDirection.INTERNET_TO_ENDPOINT,
      );

      await expect(
        asyncIterableToArray(
          parcelStore.streamActiveBoundForEndpoints([localEndpoint1Address], true),
        ),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.INTERNET_TO_ENDPOINT),
      ).resolves.toBeNull();
    });

    test('Parcel without expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        parcel,
        ParcelDirection.INTERNET_TO_ENDPOINT,
      );
      await overrideMetadataFile({}, parcel, ParcelDirection.INTERNET_TO_ENDPOINT);

      await expect(
        asyncIterableToArray(
          parcelStore.streamActiveBoundForEndpoints([localEndpoint1Address], true),
        ),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.INTERNET_TO_ENDPOINT),
      ).resolves.toBeNull();
    });

    test('Parcel with malformed expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        parcel,
        ParcelDirection.INTERNET_TO_ENDPOINT,
      );
      await overrideMetadataFile(
        { expiryDate: 'tomorrow' },
        parcel,
        ParcelDirection.INTERNET_TO_ENDPOINT,
      );

      await expect(
        asyncIterableToArray(
          parcelStore.streamActiveBoundForEndpoints([localEndpoint1Address], true),
        ),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.INTERNET_TO_ENDPOINT),
      ).resolves.toBeNull();
    });
  });
});

describe('retrieve', () => {
  test('Nothing should be output if parcel does not exist', async () => {
    await expect(
      parcelStore.retrieve('non-existing', ParcelDirection.ENDPOINT_TO_INTERNET),
    ).resolves.toBeNull();
  });

  test('Internet-bound parcel should be output if it exists', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.store(
      parcelSerialized,
      parcel,
      ParcelDirection.ENDPOINT_TO_INTERNET,
    );

    await expect(parcelStore.retrieve(key, ParcelDirection.ENDPOINT_TO_INTERNET)).resolves.toEqual(
      parcelSerialized,
    );
  });

  test('Endpoint-bound parcel should be output if it exists', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    const key = await parcelStore.store(
      parcelSerialized,
      parcel,
      ParcelDirection.INTERNET_TO_ENDPOINT,
    );

    await expect(parcelStore.retrieve(key, ParcelDirection.INTERNET_TO_ENDPOINT)).resolves.toEqual(
      parcelSerialized,
    );
  });
});

describe('delete', () => {
  test('Non-existing parcel should be ignored', async () => {
    await parcelStore.delete('non-existing', ParcelDirection.ENDPOINT_TO_INTERNET);
  });

  test('Internet-bound parcel should be deleted if it exists', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.store(
      parcelSerialized,
      parcel,
      ParcelDirection.ENDPOINT_TO_INTERNET,
    );

    await parcelStore.delete(key, ParcelDirection.ENDPOINT_TO_INTERNET);

    await expect(
      parcelStore.retrieve(key, ParcelDirection.ENDPOINT_TO_INTERNET),
    ).resolves.toBeNull();
  });

  test('Endpoint-bound parcel should be deleted if it exists', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    const key = await parcelStore.store(
      parcelSerialized,
      parcel,
      ParcelDirection.INTERNET_TO_ENDPOINT,
    );

    await parcelStore.delete(key, ParcelDirection.INTERNET_TO_ENDPOINT);

    await expect(
      parcelStore.retrieve(key, ParcelDirection.INTERNET_TO_ENDPOINT),
    ).resolves.toBeNull();
  });

  test('Parcel metadata file should be deleted', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.store(
      parcelSerialized,
      parcel,
      ParcelDirection.ENDPOINT_TO_INTERNET,
    );
    const parcelMetadataPath = (await computeInternetBoundParcelPath(parcel)) + '.pmeta';
    await expect(fs.stat(parcelMetadataPath)).toResolve(); // Check that we got the right path

    await parcelStore.delete(key, ParcelDirection.ENDPOINT_TO_INTERNET);

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
  direction: ParcelDirection,
): Promise<void> {
  const pathCalculator =
    direction === ParcelDirection.ENDPOINT_TO_INTERNET
      ? computeInternetBoundParcelPath
      : computeEndpointBoundParcelPath;
  const metadataPath = (await pathCalculator(parcel)) + '.pmeta';
  await expect(fs.stat(metadataPath)).toResolve();
  const metadataSerialized = Buffer.isBuffer(metadata) ? metadata : serialize(metadata);
  await fs.writeFile(metadataPath, metadataSerialized);
}
