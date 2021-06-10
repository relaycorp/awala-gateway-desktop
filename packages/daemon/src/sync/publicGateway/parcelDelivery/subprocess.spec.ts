import { Certificate, Parcel } from '@relaycorp/relaynet-core';
import { RefusedParcelError, ServerError } from '@relaycorp/relaynet-poweb';
import { DeliverParcelCall, MockGSCClient } from '@relaycorp/relaynet-testing';
import { PassThrough } from 'stream';
import { Container } from 'typedi';

import { DEFAULT_PUBLIC_GATEWAY } from '../../../constants';
import { ParcelStore } from '../../../parcelStore';
import { useTemporaryAppDirs } from '../../../testUtils/appDirs';
import { setUpPKIFixture } from '../../../testUtils/crypto';
import { setUpTestDBConnection } from '../../../testUtils/db';
import { mockSpy } from '../../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../../testUtils/logging';
import * as parentSubprocess from '../../../utils/subprocess/parent';
import { GatewayRegistrar } from '../GatewayRegistrar';
import * as gscClient from '../gscClient';
import runParcelCollection from './subprocess';

setUpTestDBConnection();
useTemporaryAppDirs();

const mockLogs = mockLoggerToken();

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
  parentStream = new PassThrough({ objectMode: true });
});
mockSpy(jest.spyOn(parentSubprocess, 'makeParentStream'), () => parentStream);

let gatewayCertificate: Certificate;
let endpointPrivateKey: CryptoKey;
let endpointCertificate: Certificate;
setUpPKIFixture((keyPairSet, certPath) => {
  gatewayCertificate = certPath.privateGateway;

  endpointPrivateKey = keyPairSet.privateEndpoint.privateKey;
  endpointCertificate = certPath.privateEndpoint;
});

test('Subprocess should abort if the gateway is unregistered', async () => {
  mockGetPublicGateway.mockResolvedValue(null);

  await expect(runParcelCollection(parentStream)).resolves.toEqual(1);

  expect(mockMakeGSCClient).not.toBeCalled();
});

test('Client should connect to appropriate public gateway', async () => {
  setImmediate(endParentStream);
  await runParcelCollection(parentStream);

  expect(mockMakeGSCClient).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
});

test('Subprocess should record a log when it is ready', async () => {
  setImmediate(endParentStream);
  await runParcelCollection(parentStream);

  expect(mockLogs).toContainEqual(partialPinoLog('info', 'Ready to deliver parcels'));
});

test('Subprocess should exit with code 2 if it ends normally', async () => {
  setImmediate(endParentStream);
  await expect(runParcelCollection(parentStream)).resolves.toEqual(2);
});

describe('Parcel delivery', () => {
  let parcelStore: ParcelStore;
  beforeEach(() => {
    parcelStore = Container.get(ParcelStore);
  });

  test('Pre-existing parcels should be delivered', async () => {
    const parcelSerialized = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
    const parcelDeliveryCall = new DeliverParcelCall();
    mockGSCClient = new MockGSCClient([parcelDeliveryCall]);

    setImmediate(endParentStream);
    await runParcelCollection(parentStream);

    expect(parcelDeliveryCall.wasCalled).toBeTrue();
    expect(Buffer.from(parcelDeliveryCall.arguments!.parcelSerialized)).toEqual(parcelSerialized);
    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Delivered parcel', { parcelKey }));
  });

  test('New parcels should be delivered', async () => {
    const parcelSerialized = await makeDummyParcel();
    const parcelDeliveryCall = new DeliverParcelCall();
    mockGSCClient = new MockGSCClient([parcelDeliveryCall]);

    let parcelKey: string;
    setImmediate(async () => {
      parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
      parentStream.write(parcelKey);
      parentStream.end();
    });
    await runParcelCollection(parentStream);

    expect(parcelDeliveryCall.wasCalled).toBeTrue();
    expect(Buffer.from(parcelDeliveryCall.arguments!.parcelSerialized)).toEqual(parcelSerialized);
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Delivered parcel', { parcelKey: parcelKey!! }),
    );
  });

  test('Delivery should be signed with the right key', async () => {
    const parcelSerialized = await makeDummyParcel();
    await parcelStore.storeInternetBoundParcel(parcelSerialized);
    const parcelDeliveryCall = new DeliverParcelCall();
    mockGSCClient = new MockGSCClient([parcelDeliveryCall]);

    setImmediate(endParentStream);
    await runParcelCollection(parentStream);

    expect(parcelDeliveryCall.wasCalled).toBeTrue();
    expect(
      parcelDeliveryCall.arguments!.deliverySigner.certificate.isEqual(gatewayCertificate),
    ).toBeTrue();
  });

  test('Successfully delivered parcels should be deleted', async () => {
    const parcelSerialized = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
    mockGSCClient = new MockGSCClient([new DeliverParcelCall()]);

    setImmediate(endParentStream);
    await runParcelCollection(parentStream);

    await expect(parcelStore.retrieveInternetBoundParcel(parcelKey)).resolves.toBeNull();
  });

  test('Parcels that are no longer available should be ignored', async () => {
    mockGSCClient = new MockGSCClient([]);
    const parcelKey = 'this-no-longer-exists';

    setImmediate(async () => {
      parentStream.write(parcelKey);
      parentStream.end();
    });
    await runParcelCollection(parentStream);

    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Skipping non-existing parcel', { parcelKey }),
    );
  });

  test('Parcels refused as invalid should be deleted', async () => {
    const parcelSerialized = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
    mockGSCClient = new MockGSCClient([new DeliverParcelCall(new RefusedParcelError())]);

    setImmediate(endParentStream);
    await runParcelCollection(parentStream);

    await expect(parcelStore.retrieveInternetBoundParcel(parcelKey)).resolves.toBeNull();
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Parcel was refused by the public gateway', { parcelKey }),
    );
  });

  test('Parcel should be temporarily ignored if there was a server error', async () => {
    const parcelSerialized = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
    const serverError = new ServerError('Planets are not aligned yet');
    mockGSCClient = new MockGSCClient([new DeliverParcelCall(serverError)]);

    setImmediate(endParentStream);
    await runParcelCollection(parentStream);

    await expect(parcelStore.retrieveInternetBoundParcel(parcelKey)).resolves.not.toBeNull();
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Parcel delivery failed due to server error', {
        err: expect.objectContaining({ message: serverError.message }),
        parcelKey,
      }),
    );
  });

  test('Parcel should be temporarily ignored if there was an expected error', async () => {
    const parcelSerialized = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBoundParcel(parcelSerialized);
    const error = new Error('This is not really expected');
    mockGSCClient = new MockGSCClient([new DeliverParcelCall(error)]);

    setImmediate(endParentStream);
    await runParcelCollection(parentStream);

    await expect(parcelStore.retrieveInternetBoundParcel(parcelKey)).resolves.not.toBeNull();
    expect(mockLogs).toContainEqual(
      partialPinoLog('fatal', 'Parcel delivery failed due to unexpected error', {
        err: expect.objectContaining({ message: error.message }),
        parcelKey,
      }),
    );
  });

  async function makeDummyParcel(): Promise<Buffer> {
    const parcel = new Parcel('https://endpoint.com', endpointCertificate, Buffer.from([]));
    return Buffer.from(await parcel.serialize(endpointPrivateKey));
  }
});

function endParentStream(): void {
  parentStream.end();
}
