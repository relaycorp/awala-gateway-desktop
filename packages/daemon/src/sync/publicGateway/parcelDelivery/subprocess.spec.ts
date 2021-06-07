import { Certificate, Parcel } from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import { PassThrough } from 'stream';
import { Container } from 'typedi';

import { DEFAULT_PUBLIC_GATEWAY } from '../../../constants';
import { ParcelStore } from '../../../parcelStore';
import { useTemporaryAppDirs } from '../../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../../testUtils/db';
import { DeliverParcelCall } from '../../../testUtils/gscClient/methodCalls';
import { MockGSCClient } from '../../../testUtils/gscClient/MockGSCClient';
import { mockSpy } from '../../../testUtils/jest';
import { GatewayRegistrar } from '../GatewayRegistrar';
import * as gscClient from '../gscClient';
import runParcelCollection from './subprocess';

setUpTestDBConnection();
useTemporaryAppDirs();

let mockGSCClient: MockGSCClient | null;
beforeEach(() => {
  mockGSCClient = null;
});
const mockMakeGSCClient = mockSpy(jest.spyOn(gscClient, 'makeGSCClient'), () => mockGSCClient);
afterEach(() => {
  if (mockGSCClient) {
    expect(mockGSCClient.callsRemaining).toEqual(0);
  }
});

const mockGetPublicGateway = mockSpy(
  jest.spyOn(GatewayRegistrar.prototype, 'getPublicGateway'),
  () => ({ publicAddress: DEFAULT_PUBLIC_GATEWAY }),
);

let parentStream: PassThrough;
beforeEach(async () => {
  parentStream = new PassThrough();
});

test('Subprocess should abort if the gateway is unregistered', async () => {
  mockGetPublicGateway.mockResolvedValue(null);

  await expect(runParcelCollection(parentStream)).resolves.toEqual(1);

  expect(mockMakeGSCClient).not.toBeCalled();
});

test('Client should connect to appropriate public gateway', async () => {
  await runParcelCollection(parentStream);

  expect(mockMakeGSCClient).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
});

describe('Parcel delivery', () => {
  let parcelStore: ParcelStore;
  beforeEach(() => {
    parcelStore = Container.get(ParcelStore);
  });

  let endpointPrivateKey: CryptoKey;
  let endpointCertificate: Certificate;
  beforeAll(async () => {
    const keyPairSet = await generateNodeKeyPairSet();
    const certPath = await generatePDACertificationPath(keyPairSet);

    endpointPrivateKey = keyPairSet.privateEndpoint.privateKey;
    endpointCertificate = certPath.privateEndpoint;
  });

  test('Pre-existing parcels should be delivered', async () => {
    const parcelSerialized = await makeDummyParcel();
    await parcelStore.storeInternetBoundParcel(parcelSerialized);
    const parcelDeliveryCall = new DeliverParcelCall();
    mockGSCClient = new MockGSCClient([parcelDeliveryCall]);

    await runParcelCollection(parentStream);

    expect(parcelDeliveryCall.wasCalled).toBeTrue();
    expect(Buffer.from(parcelDeliveryCall.arguments!.parcelSerialized)).toEqual(parcelSerialized);
  });

  test('New parcels should be delivered', async () => {
    const parcelSerialized = await makeDummyParcel();
    const parcelDeliveryCall = new DeliverParcelCall();
    mockGSCClient = new MockGSCClient([parcelDeliveryCall]);

    setImmediate(async () => {
      const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
      parentStream.write(parcelKey);
    });
    await runParcelCollection(parentStream);

    expect(parcelDeliveryCall.wasCalled).toBeTrue();
    expect(Buffer.from(parcelDeliveryCall.arguments!.parcelSerialized)).toEqual(parcelSerialized);
  });

  test('Successfully delivered parcels should be deleted', async () => {
    const parcelSerialized = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
    mockGSCClient = new MockGSCClient([new DeliverParcelCall()]);

    await runParcelCollection(parentStream);

    await expect(parcelStore.retrieveInternetBoundParcel(parcelKey)).resolves.toBeNull();
  });

  test.todo('Parcels refused as invalid should be deleted');

  test.todo('Delivery should be reattempted after 5 seconds if there was a server error');

  test.todo('Process should end if public gateway refuses delivery signature');

  async function makeDummyParcel(): Promise<Buffer> {
    const parcel = new Parcel('https://endpoint.com', endpointCertificate, Buffer.from([]));
    return Buffer.from(await parcel.serialize(endpointPrivateKey));
  }
});
