import {
  Certificate,
  InvalidMessageError,
  Parcel,
  RAMFSyntaxError,
} from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import { deserialize } from 'bson';
import { subSeconds } from 'date-fns';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Container } from 'typedi';

import { FileStore } from './fileStore';
import { InvalidParcelError, MalformedParcelError, ParcelStore } from './parcelStore';
import { useTemporaryAppDirs } from './testUtils/appDirs';
import { sha256Hex } from './testUtils/crypto';
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
  });

  test('Valid parcels should be stored', async () => {
    const parcel = new Parcel(PUBLIC_ENDPOINT_ADDRESS, endpointCertificate, Buffer.from([]));
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

    await parcelStore.storeInternetBoundParcel(parcelSerialized);

    const expectedParcelPath = await computeInternetBoundParcelKey(parcel);
    const parcelFile = await fs.readFile(expectedParcelPath);
    expect(parcelFile).toEqual(parcelSerialized);
  });

  test('Parcel expiry date should be stored in metadata file', async () => {
    const parcel = new Parcel(PUBLIC_ENDPOINT_ADDRESS, endpointCertificate, Buffer.from([]));
    const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

    await parcelStore.storeInternetBoundParcel(parcelSerialized);

    const parcelPath = await computeInternetBoundParcelKey(parcel);
    const parcelMetadataPath = parcelPath + '.pmeta';
    const parcelMetadata = deserialize(await fs.readFile(parcelMetadataPath));
    expect(parcelMetadata).toHaveProperty('expiryDate', parcel.expiryDate.getTime() / 1_000);
  });

  async function computeInternetBoundParcelKey(parcel: Parcel): Promise<string> {
    return join(
      getAppDirs().data,
      'parcels',
      'internet-bound',
      await endpointCertificate.calculateSubjectPrivateAddress(),
      await sha256Hex(PUBLIC_ENDPOINT_ADDRESS + parcel.id),
    );
  }
});
