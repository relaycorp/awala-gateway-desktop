import { Certificate } from '@relaycorp/relaynet-core';
import { RefusedParcelError, ServerError } from '@relaycorp/relaynet-poweb';
import { DeliverParcelCall, MockGSCClient } from '@relaycorp/relaynet-testing';
import { PassThrough } from 'stream';
import { Container } from 'typedi';

import { DEFAULT_PUBLIC_GATEWAY } from '../../../constants';
import { ParcelStore } from '../../../parcelStore';
import { useTemporaryAppDirs } from '../../../testUtils/appDirs';
import { generatePKIFixture, mockGatewayRegistration } from '../../../testUtils/crypto';
import { setUpTestDBConnection } from '../../../testUtils/db';
import { mockSpy } from '../../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../../testUtils/logging';
import { GeneratedParcel, makeParcel } from '../../../testUtils/ramf';
import { MessageDirection } from '../../../utils/MessageDirection';
import * as gscClient from '../gscClient';
import runParcelDelivery from './subprocess';

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

let parentStream: PassThrough;
beforeEach(async () => {
  parentStream = new PassThrough({ objectMode: true });
});

let gatewayCertificate: Certificate;
const pkiFixtureRetriever = generatePKIFixture((_keyPairSet, certPath) => {
  gatewayCertificate = certPath.privateGateway;
});
const undoGatewayRegistration = mockGatewayRegistration(pkiFixtureRetriever);

test('Subprocess should abort if the gateway is unregistered', async () => {
  await undoGatewayRegistration();

  await expect(runParcelDelivery(parentStream)).resolves.toEqual(1);

  expect(mockMakeGSCClient).not.toBeCalled();
});

test('Client should connect to appropriate public gateway', async () => {
  setImmediate(endParentStream);
  await runParcelDelivery(parentStream);

  expect(mockMakeGSCClient).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
});

test('Subprocess should record a log when it is ready', async () => {
  setImmediate(endParentStream);
  await runParcelDelivery(parentStream);

  expect(mockLogs).toContainEqual(partialPinoLog('info', 'Ready to deliver parcels'));
});

test('Subprocess should exit with code 2 if it ends normally', async () => {
  setImmediate(endParentStream);
  await expect(runParcelDelivery(parentStream)).resolves.toEqual(2);
});

describe('Parcel delivery', () => {
  let parcelStore: ParcelStore;
  beforeEach(() => {
    parcelStore = Container.get(ParcelStore);
  });

  test('Pre-existing parcels should be delivered', async () => {
    const { parcel, parcelSerialized } = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
    const parcelDeliveryCall = new DeliverParcelCall();
    mockGSCClient = new MockGSCClient([parcelDeliveryCall]);

    setImmediate(endParentStream);
    await runParcelDelivery(parentStream);

    expect(parcelDeliveryCall.wasCalled).toBeTrue();
    expect(Buffer.from(parcelDeliveryCall.arguments!.parcelSerialized)).toEqual(parcelSerialized);
    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Delivered parcel', { parcelKey }));
  });

  test('New parcels should be delivered', async () => {
    const { parcel, parcelSerialized } = await makeDummyParcel();
    const parcelDeliveryCall = new DeliverParcelCall();
    mockGSCClient = new MockGSCClient([parcelDeliveryCall]);

    let parcelKey: string;
    setImmediate(async () => {
      parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
      parentStream.write(parcelKey);
      parentStream.end();
    });
    await runParcelDelivery(parentStream);

    expect(parcelDeliveryCall.wasCalled).toBeTrue();
    expect(Buffer.from(parcelDeliveryCall.arguments!.parcelSerialized)).toEqual(parcelSerialized);
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Delivered parcel', { parcelKey: parcelKey!! }),
    );
  });

  test('Delivery should be signed with the right key', async () => {
    const { parcel, parcelSerialized } = await makeDummyParcel();
    await parcelStore.storeInternetBound(parcelSerialized, parcel);
    const parcelDeliveryCall = new DeliverParcelCall();
    mockGSCClient = new MockGSCClient([parcelDeliveryCall]);

    setImmediate(endParentStream);
    await runParcelDelivery(parentStream);

    expect(parcelDeliveryCall.wasCalled).toBeTrue();
    expect(
      parcelDeliveryCall.arguments!.deliverySigner.certificate.isEqual(gatewayCertificate),
    ).toBeTrue();
  });

  test('Successfully delivered parcels should be deleted', async () => {
    const { parcel, parcelSerialized } = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
    mockGSCClient = new MockGSCClient([new DeliverParcelCall()]);

    setImmediate(endParentStream);
    await runParcelDelivery(parentStream);

    await expect(
      parcelStore.retrieve(parcelKey, MessageDirection.TOWARDS_INTERNET),
    ).resolves.toBeNull();
  });

  test('Parcels that are no longer available should be ignored', async () => {
    mockGSCClient = new MockGSCClient([]);
    const parcelKey = 'this-no-longer-exists';

    setImmediate(async () => {
      parentStream.write(parcelKey);
      parentStream.end();
    });
    await runParcelDelivery(parentStream);

    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Skipping non-existing parcel', { parcelKey }),
    );
  });

  test('Parcels refused as invalid should be deleted', async () => {
    const { parcel, parcelSerialized } = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
    mockGSCClient = new MockGSCClient([new DeliverParcelCall(new RefusedParcelError())]);

    setImmediate(endParentStream);
    await runParcelDelivery(parentStream);

    await expect(
      parcelStore.retrieve(parcelKey, MessageDirection.TOWARDS_INTERNET),
    ).resolves.toBeNull();
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Parcel was refused by the public gateway', { parcelKey }),
    );
  });

  test('Parcel should be temporarily ignored if there was a server error', async () => {
    const { parcel, parcelSerialized } = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
    const serverError = new ServerError('Planets are not aligned yet');
    mockGSCClient = new MockGSCClient([new DeliverParcelCall(serverError)]);

    setImmediate(endParentStream);
    await runParcelDelivery(parentStream);

    await expect(
      parcelStore.retrieve(parcelKey, MessageDirection.TOWARDS_INTERNET),
    ).resolves.not.toBeNull();
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Parcel delivery failed due to server error', {
        err: expect.objectContaining({ message: serverError.message }),
        parcelKey,
      }),
    );
  });

  test('Parcel should be temporarily ignored if there was an expected error', async () => {
    const { parcel, parcelSerialized } = await makeDummyParcel();
    const parcelKey = await parcelStore.storeInternetBound(parcelSerialized, parcel);
    const error = new Error('This is not really expected');
    mockGSCClient = new MockGSCClient([new DeliverParcelCall(error)]);

    setImmediate(endParentStream);
    await runParcelDelivery(parentStream);

    await expect(
      parcelStore.retrieve(parcelKey, MessageDirection.TOWARDS_INTERNET),
    ).resolves.not.toBeNull();
    expect(mockLogs).toContainEqual(
      partialPinoLog('fatal', 'Parcel delivery failed due to unexpected error', {
        err: expect.objectContaining({ message: error.message }),
        parcelKey,
      }),
    );
  });

  async function makeDummyParcel(): Promise<GeneratedParcel> {
    const { pdaCertPath, keyPairSet } = pkiFixtureRetriever();
    return makeParcel(MessageDirection.TOWARDS_INTERNET, pdaCertPath, keyPairSet);
  }
});

function endParentStream(): void {
  parentStream.end();
}
