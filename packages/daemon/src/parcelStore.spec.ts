import {
  Certificate,
  InvalidMessageError,
  Parcel,
  RAMFSyntaxError,
} from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import { deserialize, Document, serialize } from 'bson';
import { subSeconds } from 'date-fns';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Container } from 'typedi';

import { FileStore } from './fileStore';
import { InvalidParcelError, MalformedParcelError, ParcelStore } from './parcelStore';
import { useTemporaryAppDirs } from './testUtils/appDirs';
import { sha256Hex } from './testUtils/crypto';
import { asyncIterableToArray } from './testUtils/iterables';
import { getPromiseRejection } from './testUtils/promises';

const getAppDirs = useTemporaryAppDirs();

let endpointPrivateKey: CryptoKey;
let endpointCertificate: Certificate;
beforeAll(async () => {
  const keyPairSet = await generateNodeKeyPairSet();
  const certPath = await generatePDACertificationPath(keyPairSet);

  endpointPrivateKey = keyPairSet.privateEndpoint.privateKey;
  endpointCertificate = certPath.privateEndpoint;
});

let parcelStore: ParcelStore;
beforeEach(() => {
  parcelStore = new ParcelStore(Container.get(FileStore));
});

const PUBLIC_ENDPOINT_ADDRESS = 'https://endpoint.com';

describe('storeInternetBoundParcel', () => {
  test('Malformed parcels should be refused', async () => {
    const error = await getPromiseRejection(
      parcelStore.storeInternetBoundParcel(Buffer.from('malformed')),
      MalformedParcelError,
    );

    expect(error.cause()).toBeInstanceOf(RAMFSyntaxError);
  });

  test('Well-formed yet invalid parcels should be refused', async () => {
    const parcel = new Parcel(PUBLIC_ENDPOINT_ADDRESS, endpointCertificate, Buffer.from([]), {
      creationDate: subSeconds(new Date(), 2),
      ttl: 1,
    });
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

    const error = await getPromiseRejection(
      parcelStore.storeInternetBoundParcel(parcelSerialized),
      InvalidParcelError,
    );

    expect(error.cause()).toBeInstanceOf(InvalidMessageError);
    const parcelPath = await computeInternetBoundParcelPath(parcel);
    await expect(fs.stat(parcelPath)).toReject();
  });

  test('Valid parcels should be stored', async () => {
    const parcel = makeDummyParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

    await parcelStore.storeInternetBoundParcel(parcelSerialized);

    const expectedParcelPath = await computeInternetBoundParcelPath(parcel);
    const parcelFile = await fs.readFile(expectedParcelPath);
    expect(parcelFile).toEqual(parcelSerialized);
  });

  test('Stored parcel key should be output', async () => {
    const parcel = makeDummyParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

    const key = await parcelStore.storeInternetBoundParcel(parcelSerialized);

    expect(key).toEqual(await computeInternetBoundParcelKey(parcel));
  });

  test('Parcel expiry date should be stored in metadata file', async () => {
    const parcel = makeDummyParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

    await parcelStore.storeInternetBoundParcel(parcelSerialized);

    const parcelPath = await computeInternetBoundParcelPath(parcel);
    const parcelMetadataPath = parcelPath + '.pmeta';
    const parcelMetadata = deserialize(await fs.readFile(parcelMetadataPath));
    expect(parcelMetadata).toHaveProperty('expiryDate', parcel.expiryDate.getTime() / 1_000);
  });
});

describe('retrieveInternetBoundParcels', () => {
  test('No parcels should be output if there are none', async () => {
    await expect(
      asyncIterableToArray(parcelStore.listActiveInternetBoundParcels()),
    ).resolves.toHaveLength(0);
  });

  test('Expired parcels should be skipped and deleted', async () => {
    const parcel = makeDummyParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
    const key = await parcelStore.storeInternetBoundParcel(parcelSerialized);
    // Override the metadata to mark the parcel as expired
    const expiryDate = subSeconds(new Date(), 1);
    await overrideMetadataFile({ expiryDate }, parcel);

    await expect(
      asyncIterableToArray(parcelStore.listActiveInternetBoundParcels()),
    ).resolves.toHaveLength(0);

    await expect(parcelStore.retrieveInternetBoundParcel(key)).resolves.toBeNull();
  });

  test('Parcels should be output', async () => {
    const parcel1 = makeDummyParcel();
    await parcelStore.storeInternetBoundParcel(
      Buffer.from(await parcel1.serialize(endpointPrivateKey)),
    );
    const parcel2 = makeDummyParcel();
    await parcelStore.storeInternetBoundParcel(
      Buffer.from(await parcel2.serialize(endpointPrivateKey)),
    );

    const parcelObjects = await asyncIterableToArray(parcelStore.listActiveInternetBoundParcels());

    expect(parcelObjects).toHaveLength(2);
    expect(parcelObjects).toContain(await computeInternetBoundParcelKey(parcel1));
    expect(parcelObjects).toContain(await computeInternetBoundParcelKey(parcel2));
  });

  describe('Invalid metadata file', () => {
    test('Parcel with missing metadata file should be ignored and deleted', async () => {
      const parcel = makeDummyParcel();
      const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
      const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
      await fs.unlink((await computeInternetBoundParcelPath(parcel)) + '.pmeta');

      await expect(asyncIterableToArray(parcelStore.listActiveInternetBoundParcels())).toResolve();

      await expect(parcelStore.retrieveInternetBoundParcel(parcelKey)).resolves.toBeNull();
    });

    test('Parcel with malformed metadata should be ignored and delete', async () => {
      const parcel = makeDummyParcel();
      const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
      const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
      await overrideMetadataFile(Buffer.from('malformed'), parcel);

      await expect(asyncIterableToArray(parcelStore.listActiveInternetBoundParcels())).toResolve();

      await expect(parcelStore.retrieveInternetBoundParcel(parcelKey)).resolves.toBeNull();
    });

    test('Parcel without expiry date should be ignored and deleted', async () => {
      const parcel = makeDummyParcel();
      const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
      const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
      await overrideMetadataFile({}, parcel);

      await expect(asyncIterableToArray(parcelStore.listActiveInternetBoundParcels())).toResolve();

      await expect(parcelStore.retrieveInternetBoundParcel(parcelKey)).resolves.toBeNull();
    });

    test('Parcel with malformed expiry date should be ignored and deleted', async () => {
      const parcel = makeDummyParcel();
      const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
      const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
      await overrideMetadataFile({ expiryDate: 'tomorrow' }, parcel);

      await expect(asyncIterableToArray(parcelStore.listActiveInternetBoundParcels())).toResolve();

      await expect(parcelStore.retrieveInternetBoundParcel(parcelKey)).resolves.toBeNull();
    });
  });

  async function overrideMetadataFile(metadata: Document | Buffer, parcel: Parcel): Promise<void> {
    const metadataPath = (await computeInternetBoundParcelPath(parcel)) + '.pmeta';
    await expect(fs.stat(metadataPath)).toResolve();
    const metadataSerialized = Buffer.isBuffer(metadata) ? metadata : serialize(metadata);
    await fs.writeFile(metadataPath, metadataSerialized);
  }
});

describe('retrieveInternetBoundParcel', () => {
  test('Nothing should be output if parcel does not exist', async () => {
    await expect(parcelStore.retrieveInternetBoundParcel('non-existing')).resolves.toBeNull();
  });

  test('Parcel should be output if it exists', async () => {
    const parcel = makeDummyParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
    const key = await parcelStore.storeInternetBoundParcel(parcelSerialized);

    await expect(parcelStore.retrieveInternetBoundParcel(key)).resolves.toEqual(parcelSerialized);
  });
});

describe('deleteInternetBoundParcel', () => {
  test('Non-existing parcel should be ignored', async () => {
    await parcelStore.deleteInternetBoundParcel('non-existing');
  });

  test('Existing parcel should be deleted', async () => {
    const parcel = makeDummyParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
    const key = await parcelStore.storeInternetBoundParcel(parcelSerialized);

    await parcelStore.deleteInternetBoundParcel(key);

    await expect(parcelStore.retrieveInternetBoundParcel(key)).resolves.toBeNull();
  });

  test('Parcel metadata file should be deleted', async () => {
    const parcel = makeDummyParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
    const key = await parcelStore.storeInternetBoundParcel(parcelSerialized);
    const parcelMetadataPath = (await computeInternetBoundParcelPath(parcel)) + '.pmeta';
    await expect(fs.stat(parcelMetadataPath)).toResolve(); // Check that we got the right path

    await parcelStore.deleteInternetBoundParcel(key);

    await expect(fs.stat(parcelMetadataPath)).toReject();
  });
});

function makeDummyParcel(): Parcel {
  return new Parcel(PUBLIC_ENDPOINT_ADDRESS, endpointCertificate, Buffer.from([]));
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
    await endpointCertificate.calculateSubjectPrivateAddress(),
    await sha256Hex(PUBLIC_ENDPOINT_ADDRESS + parcel.id),
  );
}
