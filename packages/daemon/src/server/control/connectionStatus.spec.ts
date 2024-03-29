import { MockClient } from '@relaycorp/ws-mock';
import { Container } from 'typedi';

import { ConnectionStatus, StatusMonitor } from '../../sync/StatusMonitor';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { restoreStatusMonitor } from '../../testUtils/connectionStatus';
import { setUpTestDBConnection } from '../../testUtils/db';
import { mockLoggerToken } from '../../testUtils/logging';
import { MockAuthClient, mockWebsocketStream } from '../../testUtils/websocket';
import makeConnectionStatusServer from './connectionStatus';

setUpTestDBConnection();
useTemporaryAppDirs();
mockLoggerToken();

mockWebsocketStream();
restoreStatusMonitor();

beforeEach(async () => {
  const statusMonitor = Container.get(StatusMonitor);
  statusMonitor.setLastStatus(ConnectionStatus.DISCONNECTED);
});

const AUTH_TOKEN = 'token';

test('Status changes should be streamed', async () => {
  const server = makeConnectionStatusServer(AUTH_TOKEN);
  const client = new MockAuthClient(server, AUTH_TOKEN);

  await client.use(async () => {
    await expect(client.receive()).resolves.toEqual(ConnectionStatus.DISCONNECTED);

    const statusMonitor = Container.get(StatusMonitor);
    statusMonitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);
    await expect(client.receive()).resolves.toEqual(ConnectionStatus.CONNECTED_TO_COURIER);
  });
});

test('Auth should be required', async () => {
  const server = makeConnectionStatusServer(AUTH_TOKEN);
  const client = new MockClient(server);

  await client.use(async () => {
    await expect(client.waitForPeerClosure()).resolves.toHaveProperty('code', 1008);
  });
});

test('CORS should be allowed', async () => {
  const server = makeConnectionStatusServer(AUTH_TOKEN);
  const client = new MockAuthClient(server, AUTH_TOKEN, { origin: 'https://example.com' });

  await client.use(async () => {
    await expect(client.receive()).toResolve();
  });
});
