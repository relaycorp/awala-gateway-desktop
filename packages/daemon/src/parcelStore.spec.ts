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
import {
  InvalidParcelError,
  MalformedParcelError,
  ParcelDirection,
  ParcelStore,
} from './parcelStore';
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

describe('store', () => {
  test('Malformed parcels should be refused', async () => {
    const error = await getPromiseRejection(
      parcelStore.store(Buffer.from('malformed'), ParcelDirection.TO_INTERNET),
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
      parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET),
      InvalidParcelError,
    );

    expect(error.cause()).toBeInstanceOf(InvalidMessageError);
    const parcelPath = await computeInternetBoundParcelPath(parcel);
    await expect(fs.stat(parcelPath)).toReject();
  });

  test('Valid parcels should be stored', async () => {
    const parcel = makeInternetBoundParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

    await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);

    const expectedParcelPath = await computeInternetBoundParcelPath(parcel);
    const parcelFile = await fs.readFile(expectedParcelPath);
    expect(parcelFile).toEqual(parcelSerialized);
  });

  test('Stored parcel key should be output', async () => {
    const parcel = makeInternetBoundParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

    const key = await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);

    expect(key).toEqual(await computeInternetBoundParcelKey(parcel));
  });

  test('Parcel expiry date should be stored in metadata file', async () => {
    const parcel = makeInternetBoundParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

    await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);

    const parcelPath = await computeInternetBoundParcelPath(parcel);
    const parcelMetadataPath = parcelPath + '.pmeta';
    const parcelMetadata = deserialize(await fs.readFile(parcelMetadataPath));
    expect(parcelMetadata).toHaveProperty('expiryDate', parcel.expiryDate.getTime() / 1_000);
  });
});

describe('listActive', () => {
  test('No parcels should be output if there are none', async () => {
    await expect(
      asyncIterableToArray(parcelStore.listActive(ParcelDirection.TO_INTERNET)),
    ).resolves.toHaveLength(0);
  });

  test('Expired parcels should be skipped and deleted', async () => {
    const parcel = makeInternetBoundParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
    const key = await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);
    // Override the metadata to mark the parcel as expired
    const expiryDate = subSeconds(new Date(), 1);
    await overrideMetadataFile({ expiryDate }, parcel);

    await expect(
      asyncIterableToArray(parcelStore.listActive(ParcelDirection.TO_INTERNET)),
    ).resolves.toHaveLength(0);

    await expect(parcelStore.retrieve(key, ParcelDirection.TO_INTERNET)).resolves.toBeNull();
  });

  test('Parcels should be output', async () => {
    const parcel1 = makeInternetBoundParcel();
    await parcelStore.store(
      Buffer.from(await parcel1.serialize(endpointPrivateKey)),
      ParcelDirection.TO_INTERNET,
    );
    const parcel2 = makeInternetBoundParcel();
    await parcelStore.store(
      Buffer.from(await parcel2.serialize(endpointPrivateKey)),
      ParcelDirection.TO_INTERNET,
    );

    const parcelObjects = await asyncIterableToArray(
      parcelStore.listActive(ParcelDirection.TO_INTERNET),
    );

    expect(parcelObjects).toHaveLength(2);
    expect(parcelObjects).toContain(await computeInternetBoundParcelKey(parcel1));
    expect(parcelObjects).toContain(await computeInternetBoundParcelKey(parcel2));
  });

  describe('Invalid metadata file', () => {
    test('Parcel with missing metadata file should be ignored and deleted', async () => {
      const parcel = makeInternetBoundParcel();
      const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
      const parcelKey = await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);
      await fs.unlink((await computeInternetBoundParcelPath(parcel)) + '.pmeta');

      await expect(
        asyncIterableToArray(parcelStore.listActive(ParcelDirection.TO_INTERNET)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.TO_INTERNET),
      ).resolves.toBeNull();
    });

    test('Parcel with malformed metadata should be ignored and delete', async () => {
      const parcel = makeInternetBoundParcel();
      const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
      const parcelKey = await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);
      await overrideMetadataFile(Buffer.from('malformed'), parcel);

      await expect(
        asyncIterableToArray(parcelStore.listActive(ParcelDirection.TO_INTERNET)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.TO_INTERNET),
      ).resolves.toBeNull();
    });

    test('Parcel without expiry date should be ignored and deleted', async () => {
      const parcel = makeInternetBoundParcel();
      const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
      const parcelKey = await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);
      await overrideMetadataFile({}, parcel);

      await expect(
        asyncIterableToArray(parcelStore.listActive(ParcelDirection.TO_INTERNET)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.TO_INTERNET),
      ).resolves.toBeNull();
    });

    test('Parcel with malformed expiry date should be ignored and deleted', async () => {
      const parcel = makeInternetBoundParcel();
      const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
      const parcelKey = await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);
      await overrideMetadataFile({ expiryDate: 'tomorrow' }, parcel);

      await expect(
        asyncIterableToArray(parcelStore.listActive(ParcelDirection.TO_INTERNET)),
      ).toResolve();

      await expect(
        parcelStore.retrieve(parcelKey, ParcelDirection.TO_INTERNET),
      ).resolves.toBeNull();
    });
  });

  async function overrideMetadataFile(metadata: Document | Buffer, parcel: Parcel): Promise<void> {
    const metadataPath = (await computeInternetBoundParcelPath(parcel)) + '.pmeta';
    await expect(fs.stat(metadataPath)).toResolve();
    const metadataSerialized = Buffer.isBuffer(metadata) ? metadata : serialize(metadata);
    await fs.writeFile(metadataPath, metadataSerialized);
  }
});

describe('retrieve', () => {
  test('Nothing should be output if parcel does not exist', async () => {
    await expect(
      parcelStore.retrieve('non-existing', ParcelDirection.TO_INTERNET),
    ).resolves.toBeNull();
  });

  test('Parcel should be output if it exists', async () => {
    const parcel = makeInternetBoundParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
    const key = await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);

    await expect(parcelStore.retrieve(key, ParcelDirection.TO_INTERNET)).resolves.toEqual(
      parcelSerialized,
    );
  });
});

describe('delete', () => {
  test('Non-existing parcel should be ignored', async () => {
    await parcelStore.delete('non-existing', ParcelDirection.TO_INTERNET);
  });

  test('Existing parcel should be deleted', async () => {
    const parcel = makeInternetBoundParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
    const key = await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);

    await parcelStore.delete(key, ParcelDirection.TO_INTERNET);

    await expect(parcelStore.retrieve(key, ParcelDirection.TO_INTERNET)).resolves.toBeNull();
  });

  test('Parcel metadata file should be deleted', async () => {
    const parcel = makeInternetBoundParcel();
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
    const key = await parcelStore.store(parcelSerialized, ParcelDirection.TO_INTERNET);
    const parcelMetadataPath = (await computeInternetBoundParcelPath(parcel)) + '.pmeta';
    await expect(fs.stat(parcelMetadataPath)).toResolve(); // Check that we got the right path

    await parcelStore.delete(key, ParcelDirection.TO_INTERNET);

    await expect(fs.stat(parcelMetadataPath)).toReject();
  });
});

function makeInternetBoundParcel(): Parcel {
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
