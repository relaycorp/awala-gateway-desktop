import {
  Certificate,
  InvalidMessageError,
  ParcelCollection,
  PublicAddressingError,
  RAMFSyntaxError,
  StreamingMode,
  UnreachableResolverError,
} from '@relaycorp/relaynet-core';
import { CollectParcelsCall, MockGSCClient } from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { PassThrough } from 'stream';

import { DEFAULT_PUBLIC_GATEWAY } from '../../../constants';
import { ParcelStore } from '../../../parcelStore';
import { useTemporaryAppDirs } from '../../../testUtils/appDirs';
import { generatePKIFixture, mockGatewayRegistration } from '../../../testUtils/crypto';
import { setUpTestDBConnection } from '../../../testUtils/db';
import { arrayToAsyncIterable } from '../../../testUtils/iterables';
import { mockSpy } from '../../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../../testUtils/logging';
import { GeneratedParcel, makeParcel } from '../../../testUtils/ramf';
import { recordReadableStreamMessages } from '../../../testUtils/stream';
import { mockSleepSeconds } from '../../../testUtils/timing';
import { MessageDirection } from '../../../utils/MessageDirection';
import * as gscClient from '../gscClient';
import { ParcelCollectionNotification, ParcelCollectorStatus } from './messaging';
import runParcelCollection from './subprocess';

setUpTestDBConnection();
useTemporaryAppDirs();

const mockLogs = mockLoggerToken();

const mockMakeGSCClient = mockSpy(jest.spyOn(gscClient, 'makeGSCClient'), () => {
  throw new Error('Define the client explicitly in each test');
});

let privateGatewayCertificate: Certificate;
const retrievePKIFixture = generatePKIFixture((_keyPairSet, certPath) => {
  privateGatewayCertificate = certPath.privateGateway;
});
const undoGatewayRegistration = mockGatewayRegistration(retrievePKIFixture);

let parentStream: PassThrough;
beforeEach(() => {
  parentStream = new PassThrough({ objectMode: true });
});
afterEach(() => {
  parentStream.destroy();
});

const mockParcelStore = mockSpy(jest.spyOn(ParcelStore.prototype, 'storeEndpointBound'), () => {
  // Do nothing
});

test('Subprocess should abort if the gateway is unregistered', async () => {
  await undoGatewayRegistration();

  await expect(runParcelCollection(parentStream)).resolves.toEqual(1);

  expect(mockMakeGSCClient).not.toBeCalled();
  expect(mockLogs).toContainEqual(partialPinoLog('fatal', 'Private gateway is not registered'));
});

test('Client should connect to appropriate public gateway', async () => {
  addEmptyParcelCollectionCall();

  await runParcelCollection(parentStream);

  expect(mockMakeGSCClient).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
});

test('Subprocess should record a log when it is ready', async () => {
  addEmptyParcelCollectionCall();

  await runParcelCollection(parentStream);

  expect(mockLogs).toContainEqual(partialPinoLog('info', 'Ready to collect parcels'));
});

test('Subprocess should initially mark the status as disconnected', async () => {
  addEmptyParcelCollectionCall();
  const getParentMessages = recordReadableStreamMessages(parentStream);

  await runParcelCollection(parentStream);

  const expectedStatus: ParcelCollectorStatus = { status: 'disconnected', type: 'status' };
  expect(getParentMessages()[0]).toEqual(expectedStatus);
});

test('Subprocess should exit with code 2 if it ends normally', async () => {
  addEmptyParcelCollectionCall();

  await expect(runParcelCollection(parentStream)).resolves.toEqual(2);

  expect(mockLogs).toContainEqual(partialPinoLog('fatal', 'Parcel collection ended unexpectedly'));
});

describe('Parcel collection', () => {
  test('Collection should be signed with the right key', async () => {
    const call = addEmptyParcelCollectionCall();

    await runParcelCollection(parentStream);

    expect(call.wasCalled).toBeTrue();
    expect(call.arguments!.nonceSigners).toHaveLength(1);
    expect(
      call.arguments!.nonceSigners[0].certificate.isEqual(privateGatewayCertificate),
    ).toBeTrue();
  });

  test('Connection should be kept alive', async () => {
    const call = addEmptyParcelCollectionCall();

    await runParcelCollection(parentStream);

    expect(call.wasCalled).toBeTrue();
    expect(call.arguments!.streamingMode).toEqual(StreamingMode.KEEP_ALIVE);
  });

  test('Debug log should be recorded when handshake completes successfully', async () => {
    const call = addEmptyParcelCollectionCall();

    await runParcelCollection(parentStream);

    expect(call.wasCalled).toBeTrue();
    call.arguments?.handshakeCallback!();
    expect(mockLogs).toContainEqual(partialPinoLog('debug', 'Handshake completed successfully'));
  });

  test('Malformed parcels should be ACKed and ignored', async () => {
    const malformedParcelSerialized = Buffer.from('malformed');
    const collectionAck = jest.fn();
    addParcelCollectionCall(malformedParcelSerialized, collectionAck);

    await runParcelCollection(parentStream);

    expect(mockParcelStore).not.toBeCalled();
    expect(collectionAck).toBeCalled();
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Ignored malformed/invalid parcel', {
        err: expect.objectContaining({ type: RAMFSyntaxError.name }),
      }),
    );
  });

  test('Well-formed yet invalid parcel should be ACKed and ignored', async () => {
    const { parcelSerialized: invalidParcelSerialized } = await makeDummyParcel(
      MessageDirection.TOWARDS_INTERNET, // Wrong direction
    );
    const collectionAck = jest.fn();
    addParcelCollectionCall(invalidParcelSerialized, collectionAck);

    await runParcelCollection(parentStream);

    expect(mockParcelStore).not.toBeCalled();
    expect(collectionAck).toBeCalled();
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Ignored malformed/invalid parcel', {
        err: expect.objectContaining({ type: InvalidMessageError.name }),
      }),
    );
  });

  test('Valid parcels should be stored and parent process should be notified', async () => {
    const { parcel, parcelSerialized } = await makeDummyParcel();
    const collectionAck = jest.fn();
    const parcelKey = 'foo/bar';
    mockParcelStore.mockResolvedValueOnce(parcelKey);
    addParcelCollectionCall(parcelSerialized, collectionAck);

    await runParcelCollection(parentStream);

    expect(mockParcelStore).toBeCalledWith(
      parcelSerialized,
      expect.toSatisfy((p) => p.id === parcel.id),
    );
    expect(collectionAck).toBeCalled();
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Saved new parcel', {
        parcel: expect.objectContaining({
          id: parcel.id,
          key: parcelKey,
          recipientAddress: parcel.recipientAddress,
        }),
      }),
    );
  });

  test('Parent process should be notified if parcel was stored and is new', async () => {
    const { parcel, parcelSerialized } = await makeDummyParcel();
    const getParentMessages = recordReadableStreamMessages(parentStream);
    const parcelKey = 'foo/bar';
    mockParcelStore.mockResolvedValueOnce(parcelKey);
    addParcelCollectionCall(parcelSerialized, jest.fn());

    await runParcelCollection(parentStream);

    expect(mockParcelStore).toBeCalled();
    expect(getParentMessages()).toContainEqual<ParcelCollectionNotification>({
      parcelKey,
      recipientAddress: parcel.recipientAddress,
      type: 'parcelCollection',
    });
  });

  test('Parent process should not be notified if parcel is valid but was not stored', async () => {
    const { parcelSerialized } = await makeDummyParcel();
    const getParentMessages = recordReadableStreamMessages(parentStream);
    mockParcelStore.mockResolvedValueOnce(null);
    addParcelCollectionCall(parcelSerialized, jest.fn());

    await runParcelCollection(parentStream);

    expect(mockParcelStore).toBeCalled();
    expect(getParentMessages().filter((m) => m.type !== 'status')).toHaveLength(0);
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Saved new parcel', {
        parcel: expect.not.objectContaining({
          key: expect.anything(),
        }),
      }),
    );
  });
});

describe('Public gateway resolution failures', () => {
  const sleepSeconds = mockSleepSeconds();

  test('Parent process should be notified about failure', (cb) => {
    const error = new Error('oh noes');
    mockMakeGSCClient.mockRejectedValueOnce(error);
    addEmptyParcelCollectionCall();

    parentStream.once('data', (message) => {
      expect(message).toEqual<ParcelCollectorStatus>({ type: 'status', status: 'disconnected' });
      cb();
    });
    runParcelCollection(parentStream).catch(cb);
  });

  test('Parent process should be notified about successful reconnect', async () => {
    mockMakeGSCClient.mockRejectedValueOnce(new Error('oh noes'));
    addEmptyParcelCollectionCall();
    const getParentMessages = recordReadableStreamMessages(parentStream);

    await runParcelCollection(parentStream);

    expect(getParentMessages()).toContainEqual<ParcelCollectorStatus>({
      status: 'connected',
      type: 'status',
    });
  });

  test('Reconnection should be attempted after 3 seconds if DNS resolver is unreachable', async () => {
    const error = new UnreachableResolverError('Disconnected');
    mockMakeGSCClient.mockRejectedValueOnce(error);
    addEmptyParcelCollectionCall();

    await runParcelCollection(parentStream);

    expect(sleepSeconds).toBeCalledWith(3);
    expect(mockMakeGSCClient).toBeCalledTimes(2);
    expect(mockLogs).toContainEqual(partialPinoLog('debug', 'DNS resolver is unreachable'));
  });

  test('Reconnection should be attempted after 30 seconds if DNS lookup failed', async () => {
    const error = new PublicAddressingError('Invalid DNS record');
    mockMakeGSCClient.mockRejectedValueOnce(error);
    addEmptyParcelCollectionCall();

    await runParcelCollection(parentStream);

    expect(sleepSeconds).toBeCalledWith(30);
    expect(mockMakeGSCClient).toBeCalledTimes(2);
    expect(mockLogs).toContainEqual(
      partialPinoLog('error', 'Failed to resolve DNS record for public gateway', {
        err: expect.objectContaining({ message: error.message }),
      }),
    );
  });

  test('Reconnection should be attempted after 60 seconds if DNS record does not exist', async () => {
    const error = new gscClient.NonExistingAddressError('Not found');
    mockMakeGSCClient.mockRejectedValueOnce(error);
    addEmptyParcelCollectionCall();

    await runParcelCollection(parentStream);

    expect(sleepSeconds).toBeCalledWith(60);
    expect(mockMakeGSCClient).toBeCalledTimes(2);
    expect(mockLogs).toContainEqual(
      partialPinoLog('error', 'Public gateway does not appear to exist', {
        err: expect.objectContaining({ message: error.message }),
        publicGatewayAddress: DEFAULT_PUBLIC_GATEWAY,
      }),
    );
  });

  test('New parcels should continue to be processed after reconnect', async () => {
    // Collection #1
    mockMakeGSCClient.mockRejectedValueOnce(new Error('oh noes'));
    // Collection #2
    const { parcel, parcelSerialized } = await makeDummyParcel();
    addParcelCollectionCall(parcelSerialized);

    await runParcelCollection(parentStream);

    expect(mockParcelStore).toBeCalledWith(
      parcelSerialized,
      expect.toSatisfy((p) => p.id === parcel.id),
    );
  });
});

describe('Collection errors', () => {
  test('Reconnection should be attempted immediately after failure', async () => {
    // Collection #1
    const collectionError = new Error('Try again');
    const failingGSCClient = new MockGSCClient([new CollectParcelsCall(collectionError)]);
    mockMakeGSCClient.mockResolvedValueOnce(failingGSCClient);
    // Collection #2
    const call2 = addEmptyParcelCollectionCall();

    await runParcelCollection(parentStream);

    expect(call2.wasCalled).toBeTrue();
    expect(mockMakeGSCClient).toBeCalledTimes(2);
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Collection failed; will retry...', {
        err: expect.objectContaining({ message: collectionError.message }),
      }),
    );
  });

  test('New parcels should continue to be processed after reconnect', async () => {
    // Collection #1
    const failingGSCClient = new MockGSCClient([new CollectParcelsCall(new Error('Try again'))]);
    mockMakeGSCClient.mockResolvedValueOnce(failingGSCClient);
    // Collection #2
    const { parcel, parcelSerialized } = await makeDummyParcel();
    addParcelCollectionCall(parcelSerialized);

    await runParcelCollection(parentStream);

    expect(mockParcelStore).toBeCalledWith(
      parcelSerialized,
      expect.toSatisfy((p) => p.id === parcel.id),
    );
  });
});

function addEmptyParcelCollectionCall(): CollectParcelsCall {
  const call = new CollectParcelsCall(arrayToAsyncIterable([]));
  const mockGSCClient = new MockGSCClient([call]);
  mockMakeGSCClient.mockResolvedValueOnce(mockGSCClient);
  return call;
}

function addParcelCollectionCall(
  parcelSerialized: Buffer,
  ackCallback?: () => Promise<void>,
): void {
  const mockGSCClient = new MockGSCClient([
    new CollectParcelsCall(
      arrayToAsyncIterable([
        new ParcelCollection(
          bufferToArray(parcelSerialized),
          [privateGatewayCertificate],
          ackCallback ?? jest.fn(),
        ),
      ]),
    ),
  ]);
  mockMakeGSCClient.mockResolvedValueOnce(mockGSCClient);
}

async function makeDummyParcel(
  direction: MessageDirection = MessageDirection.FROM_INTERNET,
): Promise<GeneratedParcel> {
  const { pdaCertPath, keyPairSet } = retrievePKIFixture();
  return makeParcel(direction, pdaCertPath, keyPairSet);
}
