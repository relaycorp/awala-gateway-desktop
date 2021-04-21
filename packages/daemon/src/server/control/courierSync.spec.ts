import { MockClient } from '@relaycorp/ws-mock';

import { CourierSync, CourierSyncStage } from '../../sync/courierSync/CourierSync';
import {
  DisconnectedFromCourierError,
  UnregisteredGatewayError,
} from '../../sync/courierSync/errors';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../testUtils/db';
import { arrayToAsyncIterable } from '../../testUtils/iterables';
import { mockSpy } from '../../testUtils/jest';
import { makeMockLogging, MockLogging, partialPinoLog } from '../../testUtils/logging';
import { mockWebsocketStream } from '../../testUtils/websocket';
import makeCourierSyncServer from './courierSync';

setUpTestDBConnection();
useTemporaryAppDirs();

mockWebsocketStream();

let mockLogging: MockLogging;
beforeEach(() => {
  mockLogging = makeMockLogging();
});

const mockSync = mockSpy(jest.spyOn(CourierSync.prototype, 'sync'));

test('Stages should be streamed', async () => {
  mockSync.mockReturnValue(
    arrayToAsyncIterable([CourierSyncStage.COLLECTION, CourierSyncStage.WAIT]),
  );
  const server = makeCourierSyncServer(mockLogging.logger);
  const client = new MockClient(server);

  await client.connect();

  await expect(client.receive()).resolves.toEqual(CourierSyncStage.COLLECTION);
  await expect(client.receive()).resolves.toEqual(CourierSyncStage.WAIT);

  client.close();
});

test('Connection should be closed with 1000 when sync completes normally', async () => {
  mockSync.mockReturnValue(arrayToAsyncIterable([]));
  const server = makeCourierSyncServer(mockLogging.logger);
  const client = new MockClient(server);

  await client.connect();

  await expect(client.waitForPeerClosure()).resolves.toEqual({ code: 1000 });
});

test('Connection should be closed with 4000 when gateway is not yet registered', async () => {
  mockSync.mockImplementation(() => {
    throw new UnregisteredGatewayError();
  });
  const server = makeCourierSyncServer(mockLogging.logger);
  const client = new MockClient(server);

  await client.connect();

  await expect(client.waitForPeerClosure()).resolves.toEqual({
    code: 4000,
    reason: 'Gateway is not yet registered',
  });
  expect(mockLogging.logs).toContainEqual(
    partialPinoLog('warn', 'Aborting courier sync because gateway is unregistered'),
  );
});

test('Connection should be closed with 4001 when disconnected from the courier', async () => {
  mockSync.mockImplementation(() => {
    throw new DisconnectedFromCourierError();
  });
  const server = makeCourierSyncServer(mockLogging.logger);
  const client = new MockClient(server);

  await client.connect();

  await expect(client.waitForPeerClosure()).resolves.toEqual({
    code: 4001,
    reason: 'Device is not connected to a courier',
  });
  expect(mockLogging.logs).toContainEqual(
    partialPinoLog('warn', 'Aborting courier sync because device is not connected to a courier'),
  );
});

test('Connection should be closed with 1011 when an unexpected error occurs', async () => {
  const err = new Error();
  mockSync.mockImplementation(() => {
    throw err;
  });
  const server = makeCourierSyncServer(mockLogging.logger);
  const client = new MockClient(server);

  await client.connect();

  await expect(client.waitForPeerClosure()).resolves.toEqual({
    code: 1011,
    reason: 'Internal server error',
  });
  expect(mockLogging.logs).toContainEqual(
    partialPinoLog('error', 'Unexpected error when syncing with courier', {
      err: expect.objectContaining({
        message: err.message,
      }),
    }),
  );
});
