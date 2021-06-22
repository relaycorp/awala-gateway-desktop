import {
  Certificate,
  InvalidMessageError,
  ParcelCollection,
  RAMFSyntaxError,
  StreamingMode,
} from '@relaycorp/relaynet-core';
import { CollectParcelsCall, MockGSCClient } from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { PassThrough } from 'stream';

import { DEFAULT_PUBLIC_GATEWAY } from '../../../constants';
import { ParcelDirection, ParcelStore } from '../../../parcelStore';
import { useTemporaryAppDirs } from '../../../testUtils/appDirs';
import { setUpPKIFixture } from '../../../testUtils/crypto';
import { setUpTestDBConnection } from '../../../testUtils/db';
import { arrayToAsyncIterable } from '../../../testUtils/iterables';
import { mockSpy } from '../../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../../testUtils/logging';
import { makeParcel } from '../../../testUtils/ramf';
import { GatewayRegistrar } from '../GatewayRegistrar';
import * as gscClient from '../gscClient';
import runParcelCollection from './subprocess';

setUpTestDBConnection();
useTemporaryAppDirs();

const mockLogs = mockLoggerToken();

let mockGSCClient: MockGSCClient;
beforeEach(() => {
  const call = new CollectParcelsCall(arrayToAsyncIterable([]));
  mockGSCClient = new MockGSCClient([call]);
});
const mockMakeGSCClient = mockSpy(jest.spyOn(gscClient, 'makeGSCClient'), () => mockGSCClient);

const mockGetPublicGateway = mockSpy(
  jest.spyOn(GatewayRegistrar.prototype, 'getPublicGateway'),
  () => ({ publicAddress: DEFAULT_PUBLIC_GATEWAY }),
);

let parentStream: PassThrough;
beforeEach(async () => {
  parentStream = new PassThrough({ objectMode: true });
});

let privateGatewayCertificate: Certificate;
const retrievePKIFixture = setUpPKIFixture((_keyPairSet, certPath) => {
  privateGatewayCertificate = certPath.privateGateway;
});

const mockParcelStore = mockSpy(jest.spyOn(ParcelStore.prototype, 'store'), () => {
  // Do nothing
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

test('Subprocess should record a log when it is ready', async () => {
  await runParcelCollection(parentStream);

  expect(mockLogs).toContainEqual(partialPinoLog('info', 'Ready to collect parcels'));
});

test('Subprocess should exit with code 2 if it ends normally', async () => {
  await expect(runParcelCollection(parentStream)).resolves.toEqual(2);
});

describe('Parcel collection', () => {
  test('Collection should be signed with the right key', async () => {
    const call = new CollectParcelsCall(arrayToAsyncIterable([]));
    mockGSCClient = new MockGSCClient([call]);

    await runParcelCollection(parentStream);

    expect(call.wasCalled).toBeTrue();
    expect(call.arguments!.nonceSigners).toHaveLength(1);
    expect(
      call.arguments!.nonceSigners[0].certificate.isEqual(privateGatewayCertificate),
    ).toBeTrue();
  });

  test('Connection should be kept alive', async () => {
    const call = new CollectParcelsCall(arrayToAsyncIterable([]));
    mockGSCClient = new MockGSCClient([call]);

    await runParcelCollection(parentStream);

    expect(call.wasCalled).toBeTrue();
    expect(call.arguments!.streamingMode).toEqual(StreamingMode.KEEP_ALIVE);
  });

  test('Parent process should be notified when handshake completes successfully', async (cb) => {
    const call = new CollectParcelsCall(arrayToAsyncIterable([]));
    mockGSCClient = new MockGSCClient([call]);

    await runParcelCollection(parentStream);

    parentStream.on('data', (chunk) => {
      expect(chunk).toEqual({ type: 'status', status: 'connected' });
      cb();
    });
    expect(call.wasCalled).toBeTrue();
    call.arguments?.handshakeCallback!();
  });

  test('Malformed parcels should be ACKed and ignored', async () => {
    const malformedParcelSerialized = Buffer.from('malformed');
    const collectionAck = jest.fn();
    mockGSCClient = new MockGSCClient([
      new CollectParcelsCall(
        arrayToAsyncIterable([
          new ParcelCollection(
            bufferToArray(malformedParcelSerialized),
            [privateGatewayCertificate],
            collectionAck,
          ),
        ]),
      ),
    ]);

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
    const { certPath, keyPairSet } = retrievePKIFixture();
    const { parcelSerialized: invalidParcelSerialized } = await makeParcel(
      ParcelDirection.ENDPOINT_TO_INTERNET, // Wrong direction
      certPath,
      keyPairSet,
    );
    const collectionAck = jest.fn();
    mockGSCClient = new MockGSCClient([
      new CollectParcelsCall(
        arrayToAsyncIterable([
          new ParcelCollection(
            bufferToArray(invalidParcelSerialized),
            [privateGatewayCertificate],
            collectionAck,
          ),
        ]),
      ),
    ]);

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
    const { certPath, keyPairSet } = retrievePKIFixture();
    const { parcel, parcelSerialized } = await makeParcel(
      ParcelDirection.INTERNET_TO_ENDPOINT,
      certPath,
      keyPairSet,
    );
    const collectionAck = jest.fn();
    mockGSCClient = new MockGSCClient([
      new CollectParcelsCall(
        arrayToAsyncIterable([
          new ParcelCollection(
            bufferToArray(parcelSerialized),
            [privateGatewayCertificate],
            collectionAck,
          ),
        ]),
      ),
    ]);

    await runParcelCollection(parentStream);

    expect(mockParcelStore).toBeCalledWith(
      parcelSerialized,
      expect.toSatisfy((p) => p.id === parcel.id),
      ParcelDirection.INTERNET_TO_ENDPOINT,
    );
    expect(collectionAck).toBeCalled();
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Saved new parcel', {
        parcel: expect.objectContaining({
          id: parcel.id,
          recipient: parcel.recipientAddress,
        }),
      }),
    );
  });
});

test.todo('Parent process should be notified about failure to resolve public gateway address');

describe('Reconnections', () => {
  test.todo('Reconnection should be attempted 3 seconds after failure');

  test.todo('Parent process should be notified about successful reconnects');

  test.todo('New parcels should continue to be processed after reconnect');
});
