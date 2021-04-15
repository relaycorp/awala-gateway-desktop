import { MockClient } from '@relaycorp/ws-mock';
import { Container } from 'typedi';

import { ConnectionStatus, StatusMonitor } from '../../sync/StatusMonitor';
import { restoreStatusMonitor } from '../../testUtils/connectionStatus';
import { makeMockLogging, MockLogging } from '../../testUtils/logging';
import { mockWebsocketStream } from '../../testUtils/websocket';
import makeConnectionStatusServer from './connectionStatus';

mockWebsocketStream();
restoreStatusMonitor();

let mockLogging: MockLogging;
beforeEach(() => {
  mockLogging = makeMockLogging();
});

describe('Stream', () => {
  test('Status changes should be streamed', async () => {
    const server = makeConnectionStatusServer(mockLogging.logger);
    const client = new MockClient(server);

    await client.connect();

    await expect(client.receive()).resolves.toEqual(ConnectionStatus.DISCONNECTED_FROM_ALL);

    const statusMonitor = Container.get(StatusMonitor);
    statusMonitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);
    await expect(client.receive()).resolves.toEqual(ConnectionStatus.CONNECTED_TO_COURIER);

    client.close();
  });

  test('The connection should be closed when the client closes it', async () => {
    const server = makeConnectionStatusServer(mockLogging.logger);
    const client = new MockClient(server);

    await client.connect();
    await expect(client.receive()).resolves.toEqual(ConnectionStatus.DISCONNECTED_FROM_ALL);

    client.close();
    await expect(client.waitForPeerClosure()).resolves.toEqual({ code: 1000 });
  });
});
