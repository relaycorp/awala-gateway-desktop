import {
  Certificate,
  generateRSAKeyPair,
  InvalidMessageError,
  issueEndpointCertificate,
  Parcel,
  RAMFSyntaxError,
} from '@relaycorp/relaynet-core';
import { deserialize, Document, serialize } from 'bson';
import { addDays, subSeconds } from 'date-fns';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Container } from 'typedi';

import { FileStore } from './fileStore';
import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import {
  InvalidParcelError,
  MalformedParcelError,
  ParcelDirection,
  ParcelStore,
} from './parcelStore';
import { useTemporaryAppDirs } from './testUtils/appDirs';
import { setUpPKIFixture, sha256Hex } from './testUtils/crypto';
import { setUpTestDBConnection } from './testUtils/db';
import { asyncIterableToArray } from './testUtils/iterables';
import { getPromiseRejection } from './testUtils/promises';

setUpTestDBConnection();

const getAppDirs = useTemporaryAppDirs();

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
  test('Malformed parcels should be refused', async () => {
    const error = await getPromiseRejection(
      parcelStore.store(Buffer.from('malformed'), ParcelDirection.ENDPOINT_TO_INTERNET),
      MalformedParcelError,
    );

    expect(error.cause()).toBeInstanceOf(RAMFSyntaxError);
  });

  test('Well-formed yet invalid parcels should be refused', async () => {
    const parcel = new Parcel(PUBLIC_ENDPOINT_ADDRESS, localEndpointCertificate, Buffer.from([]), {
      creationDate: subSeconds(new Date(), 2),
      ttl: 1,
    });
    const parcelSerialized = Buffer.from(await parcel.serialize(localEndpointPrivateKey));

    const error = await getPromiseRejection(
      parcelStore.store(parcelSerialized, ParcelDirection.ENDPOINT_TO_INTERNET),
      InvalidParcelError,
    );

    expect(error.cause()).toBeInstanceOf(InvalidMessageError);
    const parcelPath = await computeInternetBoundParcelPath(parcel);
    await expect(fs.stat(parcelPath)).toReject();
  });

  test('Endpoint-bound parcels with public recipient should be refused', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();

    const error = await getPromiseRejection(
      parcelStore.store(parcelSerialized, ParcelDirection.INTERNET_TO_ENDPOINT),
      InvalidParcelError,
    );

    expect(error.cause()).toBeInstanceOf(InvalidMessageError);
    const parcelPath = await computeInternetBoundParcelPath(parcel);
    await expect(fs.stat(parcelPath)).toReject();
  });

  test('Endpoint-bound parcels with an invalid PDA should be refused', async () => {
    const unauthorizedSenderKeyPair = await generateRSAKeyPair();
    const unauthorizedSenderCertificate = await issueEndpointCertificate({
      issuerPrivateKey: unauthorizedSenderKeyPair.privateKey,
      subjectPublicKey: unauthorizedSenderKeyPair.publicKey,
      validityEndDate: addDays(new Date(), 1),
    });
    const parcel = new Parcel(
      await localEndpointCertificate.calculateSubjectPrivateAddress(),
      unauthorizedSenderCertificate,
      Buffer.from([]),
    );
    const parcelSerialized = Buffer.from(
      await parcel.serialize(unauthorizedSenderKeyPair.privateKey),
    );

    const error = await getPromiseRejection(
      parcelStore.store(parcelSerialized, ParcelDirection.INTERNET_TO_ENDPOINT),
      InvalidParcelError,
    );

    expect(error.cause()).toBeInstanceOf(InvalidMessageError);
    const parcelPath = await computeInternetBoundParcelPath(parcel);
    await expect(fs.stat(parcelPath)).toReject();
  });

  test('Valid, Internet-bound parcels should be stored', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();

    await parcelStore.store(parcelSerialized, ParcelDirection.ENDPOINT_TO_INTERNET);

    const expectedParcelPath = await computeInternetBoundParcelPath(parcel);
    const parcelFile = await fs.readFile(expectedParcelPath);
    expect(parcelFile).toEqual(parcelSerialized);
  });

  test('Valid, endpoint-bound parcels should be stored', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();

    await parcelStore.store(parcelSerialized, ParcelDirection.INTERNET_TO_ENDPOINT);

    const expectedParcelPath = await computeEndpointBoundParcelPath(parcel);
    const parcelFile = await fs.readFile(expectedParcelPath);
    expect(parcelFile).toEqual(parcelSerialized);
  });

  test('Stored parcel key should be output', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();

    const key = await parcelStore.store(parcelSerialized, ParcelDirection.ENDPOINT_TO_INTERNET);

    expect(key).toEqual(await computeInternetBoundParcelKey(parcel));
  });

  test('Parcel expiry date should be stored in metadata file', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    await parcelStore.store(parcelSerialized, ParcelDirection.ENDPOINT_TO_INTERNET);

    const parcelPath = await computeInternetBoundParcelPath(parcel);
    const parcelMetadataPath = parcelPath + '.pmeta';
    const parcelMetadata = deserialize(await fs.readFile(parcelMetadataPath));
    expect(parcelMetadata).toHaveProperty('expiryDate', parcel.expiryDate.getTime() / 1_000);
  });
});

describe('listActive', () => {
  test('No parcels should be output if there are none', async () => {
    await expect(
      asyncIterableToArray(parcelStore.listActive(ParcelDirection.ENDPOINT_TO_INTERNET)),
    ).resolves.toHaveLength(0);
  });

  test('Expired, Internet-bound parcels should be skipped and deleted', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.store(parcelSerialized, ParcelDirection.ENDPOINT_TO_INTERNET);
    // Override the metadata to mark the parcel as expired
    const expiryDate = subSeconds(new Date(), 1);
    await overrideMetadataFile({ expiryDate }, parcel, ParcelDirection.ENDPOINT_TO_INTERNET);

    await expect(
      asyncIterableToArray(parcelStore.listActive(ParcelDirection.ENDPOINT_TO_INTERNET)),
    ).resolves.toHaveLength(0);

    await expect(
      parcelStore.retrieve(key, ParcelDirection.ENDPOINT_TO_INTERNET),
    ).resolves.toBeNull();
  });

  test('Expired, endpoint-bound parcels should be skipped and deleted', async () => {
    const { parcel, parcelSerialized } = await makeEndpointBoundParcel();
    const key = await parcelStore.store(parcelSerialized, ParcelDirection.INTERNET_TO_ENDPOINT);
    // Override the metadata to mark the parcel as expired
    const expiryDate = subSeconds(new Date(), 1);
    await overrideMetadataFile({ expiryDate }, parcel, ParcelDirection.INTERNET_TO_ENDPOINT);

    await expect(
      asyncIterableToArray(parcelStore.listActive(ParcelDirection.INTERNET_TO_ENDPOINT)),
    ).resolves.toHaveLength(0);

    await expect(
      parcelStore.retrieve(key, ParcelDirection.INTERNET_TO_ENDPOINT),
    ).resolves.toBeNull();
  });

  test('Internet-bound parcels should be output when requested', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeInternetBoundParcel();
    await parcelStore.store(parcel1Serialized, ParcelDirection.ENDPOINT_TO_INTERNET);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } =
      await makeInternetBoundParcel();
    await parcelStore.store(parcel2Serialized, ParcelDirection.ENDPOINT_TO_INTERNET);

    const parcelObjects = await asyncIterableToArray(
      parcelStore.listActive(ParcelDirection.ENDPOINT_TO_INTERNET),
    );

    expect(parcelObjects).toHaveLength(2);
    expect(parcelObjects).toContain(await computeInternetBoundParcelKey(parcel1));
    expect(parcelObjects).toContain(await computeInternetBoundParcelKey(parcel2));
  });

  test('Endpoint-bound parcels should be output when requested', async () => {
    const { parcel: parcel1, parcelSerialized: parcel1Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.store(parcel1Serialized, ParcelDirection.INTERNET_TO_ENDPOINT);
    const { parcel: parcel2, parcelSerialized: parcel2Serialized } =
      await makeEndpointBoundParcel();
    await parcelStore.store(parcel2Serialized, ParcelDirection.INTERNET_TO_ENDPOINT);

    const parcelObjects = await asyncIterableToArray(
      parcelStore.listActive(ParcelDirection.INTERNET_TO_ENDPOINT),
    );

    expect(parcelObjects).toHaveLength(2);
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel1));
    expect(parcelObjects).toContain(await computeEndpointBoundParcelKey(parcel2));
  });

  describe('Invalid metadata file', () => {
    test('Parcel with missing metadata file should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );
      await fs.unlink((await computeInternetBoundParcelPath(parcel)) + '.pmeta');

      await expect(
        asyncIterableToArray(parcelStore.listActive(ParcelDirection.ENDPOINT_TO_INTERNET)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.ENDPOINT_TO_INTERNET),
      ).resolves.toBeNull();
    });

    test('Parcel with malformed metadata should be ignored and delete', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );
      await overrideMetadataFile(
        Buffer.from('malformed'),
        parcel,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );

      await expect(
        asyncIterableToArray(parcelStore.listActive(ParcelDirection.ENDPOINT_TO_INTERNET)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.ENDPOINT_TO_INTERNET),
      ).resolves.toBeNull();
    });

    test('Parcel without expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );
      await overrideMetadataFile({}, parcel, ParcelDirection.ENDPOINT_TO_INTERNET);

      await expect(
        asyncIterableToArray(parcelStore.listActive(ParcelDirection.ENDPOINT_TO_INTERNET)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.ENDPOINT_TO_INTERNET),
      ).resolves.toBeNull();
    });

    test('Parcel with malformed expiry date should be ignored and deleted', async () => {
      const { parcel, parcelSerialized } = await makeInternetBoundParcel();
      const parcelKey = await parcelStore.store(
        parcelSerialized,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );
      await overrideMetadataFile(
        { expiryDate: 'tomorrow' },
        parcel,
        ParcelDirection.ENDPOINT_TO_INTERNET,
      );

      await expect(
        asyncIterableToArray(parcelStore.listActive(ParcelDirection.ENDPOINT_TO_INTERNET)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.ENDPOINT_TO_INTERNET),
      ).resolves.toBeNull();
    });
  });

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
});

describe('retrieve', () => {
  test('Nothing should be output if parcel does not exist', async () => {
    await expect(
      parcelStore.retrieve('non-existing', ParcelDirection.ENDPOINT_TO_INTERNET),
    ).resolves.toBeNull();
  });

  test('Parcel should be output if it exists', async () => {
    const { parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.store(parcelSerialized, ParcelDirection.ENDPOINT_TO_INTERNET);

    await expect(parcelStore.retrieve(key, ParcelDirection.ENDPOINT_TO_INTERNET)).resolves.toEqual(
      parcelSerialized,
    );
  });
});

describe('delete', () => {
  test('Non-existing parcel should be ignored', async () => {
    await parcelStore.delete('non-existing', ParcelDirection.ENDPOINT_TO_INTERNET);
  });

  test('Existing parcel should be deleted', async () => {
    const { parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.store(parcelSerialized, ParcelDirection.ENDPOINT_TO_INTERNET);

    await parcelStore.delete(key, ParcelDirection.ENDPOINT_TO_INTERNET);

    await expect(
      parcelStore.retrieve(key, ParcelDirection.ENDPOINT_TO_INTERNET),
    ).resolves.toBeNull();
  });

  test('Parcel metadata file should be deleted', async () => {
    const { parcel, parcelSerialized } = await makeInternetBoundParcel();
    const key = await parcelStore.store(parcelSerialized, ParcelDirection.ENDPOINT_TO_INTERNET);
    const parcelMetadataPath = (await computeInternetBoundParcelPath(parcel)) + '.pmeta';
    await expect(fs.stat(parcelMetadataPath)).toResolve(); // Check that we got the right path

    await parcelStore.delete(key, ParcelDirection.ENDPOINT_TO_INTERNET);

    await expect(fs.stat(parcelMetadataPath)).toReject();
  });
});

interface GeneratedParcel {
  readonly parcel: Parcel;
  readonly parcelSerialized: Buffer;
}

async function makeInternetBoundParcel(): Promise<GeneratedParcel> {
  const parcel = new Parcel(PUBLIC_ENDPOINT_ADDRESS, localEndpointCertificate, Buffer.from([]));
  const parcelSerialized = Buffer.from(await parcel.serialize(localEndpointPrivateKey));
  return { parcel, parcelSerialized };
}

async function makeEndpointBoundParcel(): Promise<GeneratedParcel> {
  const parcel = new Parcel(
    await localEndpointCertificate.calculateSubjectPrivateAddress(),
    remoteEndpointCertificate,
    Buffer.from([]),
    { senderCaCertificateChain: [gatewayCertificate, localEndpointCertificate] },
  );
  const parcelSerialized = Buffer.from(await parcel.serialize(remoteEndpointPrivateKey));
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
