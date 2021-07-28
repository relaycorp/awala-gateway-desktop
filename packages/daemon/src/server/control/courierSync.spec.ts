import { MockClient } from '@relaycorp/ws-mock';

import { UnregisteredGatewayError } from '../../errors';
import { CourierSyncStage } from '../../sync/courierSync';
import { CourierSyncManager } from '../../sync/courierSync/CourierSyncManager';
import { DisconnectedFromCourierError } from '../../sync/courierSync/errors';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../testUtils/db';
import { arrayToAsyncIterable } from '../../testUtils/iterables';
import { mockSpy } from '../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { MockAuthClient, mockWebsocketStream } from '../../testUtils/websocket';
import makeCourierSyncServer from './courierSync';

setUpTestDBConnection();
useTemporaryAppDirs();

mockWebsocketStream();

const mockLogs = mockLoggerToken();

const mockSync = mockSpy(jest.spyOn(CourierSyncManager.prototype, 'sync'));

const AUTH_TOKEN = 'token';

test('Stages should be streamed', async () => {
  mockSync.mockReturnValue(
    arrayToAsyncIterable([CourierSyncStage.COLLECTION, CourierSyncStage.WAIT]),
  );
  const server = makeCourierSyncServer(AUTH_TOKEN);
  const client = new MockAuthClient(server, AUTH_TOKEN);

  await client.use(async () => {
    await expect(client.receive()).resolves.toEqual(CourierSyncStage.COLLECTION);
    await expect(client.receive()).resolves.toEqual(CourierSyncStage.WAIT);
  });
});

test('Connection should be closed with 1000 when sync completes normally', async () => {
  mockSync.mockReturnValue(arrayToAsyncIterable([]));
  const server = makeCourierSyncServer(AUTH_TOKEN);
  const client = new MockAuthClient(server, AUTH_TOKEN);

  await client.use(async () => {
    await expect(client.waitForPeerClosure()).resolves.toEqual({ code: 1000 });
  });
});

test('Connection should be closed with 4000 when gateway is not yet registered', async () => {
  mockSync.mockImplementation(() => {
    throw new UnregisteredGatewayError();
  });
  const server = makeCourierSyncServer(AUTH_TOKEN);
  const client = new MockAuthClient(server, AUTH_TOKEN);

  await client.use(async () => {
    await expect(client.waitForPeerClosure()).resolves.toEqual({
      code: 4000,
      reason: 'Gateway is not yet registered',
    });
  });

  expect(mockLogs).toContainEqual(
    partialPinoLog('warn', 'Aborting courier sync because gateway is unregistered'),
  );
});

test('Connection should be closed with 4001 when disconnected from the courier', async () => {
  mockSync.mockImplementation(() => {
    throw new DisconnectedFromCourierError();
  });
  const server = makeCourierSyncServer(AUTH_TOKEN);
  const client = new MockAuthClient(server, AUTH_TOKEN);

  await client.use(async () => {
    await expect(client.waitForPeerClosure()).resolves.toEqual({
      code: 4001,
      reason: 'Device is not connected to a courier',
    });
  });

  expect(mockLogs).toContainEqual(
    partialPinoLog('warn', 'Aborting courier sync because device is not connected to a courier'),
  );
});

test('Connection should be closed with 1011 when an unexpected error occurs', async () => {
  const err = new Error();
  mockSync.mockImplementation(() => {
    throw err;
  });
  const server = makeCourierSyncServer(AUTH_TOKEN);
  const client = new MockAuthClient(server, AUTH_TOKEN);

  await client.use(async () => {
    await expect(client.waitForPeerClosure()).resolves.toEqual({
      code: 1011,
      reason: 'Internal server error',
    });
  });

  expect(mockLogs).toContainEqual(
    partialPinoLog('error', 'Unexpected error when syncing with courier', {
      err: expect.objectContaining({
        message: err.message,
      }),
    }),
  );
});

test('Authentication should be required', async () => {
  mockSync.mockReturnValue(arrayToAsyncIterable([]));
  const server = makeCourierSyncServer(AUTH_TOKEN);
  const client = new MockClient(server);

  await client.use(async () => {
    await expect(client.waitForPeerClosure()).resolves.toHaveProperty('code', 1008);
  });
});

test('CORS should be allowed', async () => {
  mockSync.mockReturnValue(arrayToAsyncIterable([]));
  const server = makeCourierSyncServer(AUTH_TOKEN);
  const client = new MockAuthClient(server, AUTH_TOKEN, { origin: 'https://example.com' });

  await client.use(async () => {
    await expect(client.waitForPeerClosure()).resolves.toEqual({ code: 1000 });
  });
});
