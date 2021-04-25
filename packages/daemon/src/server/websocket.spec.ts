import { MockClient } from '@relaycorp/ws-mock';
import { EventEmitter } from 'events';
import { Duplex } from 'stream';
import WebSocket from 'ws';

import { makeMockLogging, MockLogging, partialPinoLog } from '../testUtils/logging';
import { mockWebsocketStream } from '../testUtils/websocket';
import { makeWebSocketServer } from './websocket';

mockWebsocketStream();

let mockLogging: MockLogging;
beforeEach(() => {
  mockLogging = makeMockLogging();
});

describe('WebSocket server configuration', () => {
  const serverResponseFrame = 'hello';

  test('Clients should not be tracked', () => {
    const wsServer = makeWebSocketServer(wsHandler, mockLogging.logger);

    expect(wsServer.options.clientTracking).toBeFalsy();
  });

  test('No HTTP server should be created', () => {
    const wsServer = makeWebSocketServer(wsHandler, mockLogging.logger);

    expect(wsServer.options.noServer).toBeTruthy();
  });

  test('CORS requests should be blocked by default', async () => {
    const mockHandler = jest.fn();
    const wsServer = makeWebSocketServer(mockHandler, mockLogging.logger);
    const mockClient = new MockClient(wsServer, { origin: 'https://example.com' });

    await mockClient.connect();
    await expect(mockClient.waitForPeerClosure()).resolves.toEqual({
      code: 1008,
      reason: 'CORS requests are disabled',
    });
    expect(mockLogging.logs).toContainEqual(partialPinoLog('info', 'Refusing CORS request'));
  });

  test('CORS requests should be allowed if requested', async () => {
    const mockHandler = (_: Duplex, socket: WebSocket) => {
      socket.close(1000);
    };
    const wsServer = makeWebSocketServer(mockHandler, mockLogging.logger, true);
    const mockClient = new MockClient(wsServer, { origin: 'https://example.com' });

    await mockClient.connect();
    await expect(mockClient.waitForPeerClosure()).resolves.toEqual({
      code: 1000,
    });
  });

  test('Specified handler should be called when connection is established', async () => {
    const handlerSpied = jest.fn().mockImplementation(wsHandler);
    const wsServer = makeWebSocketServer(handlerSpied, mockLogging.logger);
    const mockClient = new MockClient(wsServer);

    await mockClient.connect();
    await mockClient.send(serverResponseFrame);
    const response = await mockClient.receive();
    expect(response).toEqual(serverResponseFrame);
    await mockClient.waitForPeerClosure();

    expect(handlerSpied).toBeCalledWith(expect.any(Duplex), expect.any(EventEmitter));
  });

  async function wsHandler(connectionStream: Duplex, socket: WebSocket): Promise<void> {
    socket.on('message', (message) => {
      connectionStream.write(message);
    });

    setImmediate(() => socket.close());
  }
});
