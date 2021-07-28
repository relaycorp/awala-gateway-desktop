import { CloseFrame, MockClient } from '@relaycorp/ws-mock';
import { addMilliseconds, addSeconds, subMilliseconds } from 'date-fns';
import { EventEmitter } from 'events';
import { Duplex } from 'stream';
import WebSocket from 'ws';

import { useFakeTimers } from '../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../testUtils/logging';
import { mockWebsocketStream } from '../testUtils/websocket';
import { makeWebSocketServer, WebSocketCode } from './websocket';

mockWebsocketStream();
const mockLogs = mockLoggerToken();

describe('WebSocket server configuration', () => {
  const serverResponseFrame = 'hello';

  test('Clients should not be tracked', () => {
    const wsServer = makeWebSocketServer(wsHandler);

    expect(wsServer.options.clientTracking).toBeFalsy();
  });

  test('No HTTP server should be created', () => {
    const wsServer = makeWebSocketServer(wsHandler);

    expect(wsServer.options.noServer).toBeTruthy();
  });

  test('CORS request should be blocked if auth is not required', async () => {
    const mockHandler = jest.fn();
    const wsServer = makeWebSocketServer(mockHandler);
    const mockClient = new MockClient(wsServer, { origin: 'https://example.com' });

    await mockClient.use(async () => {
      await expect(mockClient.waitForPeerClosure()).resolves.toEqual({
        code: WebSocketCode.VIOLATED_POLICY,
        reason: 'CORS requests are disabled',
      });
    });
    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Refusing CORS request'));
    expect(mockHandler).not.toBeCalled();
  });

  test('CORS request should be allowed if auth is required and succeeds', async () => {
    const mockHandler = async (_: Duplex, socket: WebSocket) => {
      socket.close(1000);
    };
    const authToken = 'auth-token';
    const wsServer = makeWebSocketServer(mockHandler, { authToken });
    const mockClient = new MockClient(
      wsServer,
      { origin: 'https://example.com' },
      `/?auth=${authToken}`,
    );

    await mockClient.use(async () => {
      await expect(mockClient.waitForPeerClosure()).resolves.toEqual({
        code: 1000,
      });
    });
  });

  test('Request should be refused if auth is required and invalid token is unset', async () => {
    const mockHandler = jest.fn();
    const wsServer = makeWebSocketServer(mockHandler, { authToken: 'auth-token' });
    const mockClient = new MockClient(wsServer);

    await mockClient.use(async () => {
      await expect(mockClient.waitForPeerClosure()).resolves.toEqual({
        code: WebSocketCode.VIOLATED_POLICY,
        reason: 'Authentication is required',
      });
    });
    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Refusing unauthenticated request'));
    expect(mockHandler).not.toBeCalled();
  });

  test('Request should be refused if auth is required and invalid token is passed', async () => {
    const mockHandler = jest.fn();
    const wsServer = makeWebSocketServer(mockHandler, { authToken: 'auth-token' });
    const mockClient = new MockClient(wsServer, {}, '/?auth=invalid');

    await mockClient.use(async () => {
      await expect(mockClient.waitForPeerClosure()).resolves.toEqual({
        code: WebSocketCode.VIOLATED_POLICY,
        reason: 'Authentication is required',
      });
    });
    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Refusing unauthenticated request'));
    expect(mockHandler).not.toBeCalled();
  });

  test('Specified handler should be called when connection is established', async () => {
    const handlerSpied = jest.fn().mockImplementation(wsHandler);
    const wsServer = makeWebSocketServer(handlerSpied);
    const headers = { foo: 'bar' };
    const mockClient = new MockClient(wsServer, headers);

    await mockClient.use(async () => {
      await mockClient.send(serverResponseFrame);
      const response = await mockClient.receive();
      expect(response).toEqual(serverResponseFrame);
      await mockClient.waitForPeerClosure();
    });

    expect(handlerSpied).toBeCalledWith(expect.any(Duplex), expect.any(EventEmitter), headers);
  });

  test('Unhandled exceptions should close the connection', async () => {
    const error = new Error('unhandled!');
    const mockHandler = async () => {
      throw error;
    };
    const wsServer = makeWebSocketServer(mockHandler);
    const mockClient = new MockClient(wsServer);

    await mockClient.use(async () => {
      await expect(mockClient.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
        code: WebSocketCode.SERVER_ERROR,
        reason: 'Internal server error',
      });
    });
    expect(mockLogs).toContainEqual(
      partialPinoLog('error', 'Unhandled exception in WebSocket server handler', {
        err: expect.objectContaining({ message: error.message }),
      }),
    );
  });

  test('Connection closure should be logged', async () => {
    const wsServer = makeWebSocketServer(wsHandler);
    const mockClient = new MockClient(wsServer);
    await mockClient.connect();
    const closureReason = 'I have to run';

    mockClient.close(WebSocketCode.NORMAL, closureReason);

    expect(mockLogs).toContainEqual(
      partialPinoLog('debug', 'Closing connection', {
        code: WebSocketCode.NORMAL,
        reason: closureReason,
      }),
    );
  });

  describe('Pings', () => {
    useFakeTimers();

    const noOpWsHandler = async () => {
      // Do nothing. Not even close the connection.
    };

    const pingFrequencySeconds = 10;
    const pingFrequencyMs = pingFrequencySeconds * 1_000;

    test('No pings should be sent by default', async () => {
      const wsServer = makeWebSocketServer(noOpWsHandler);
      const mockClient = new MockClient(wsServer);

      await mockClient.use(async () => {
        jest.advanceTimersByTime(30_000);

        expect(mockClient.incomingPings).toHaveLength(0);
      });
    });

    test('Server should send pings with the specified frequency', async () => {
      const wsServer = makeWebSocketServer(noOpWsHandler, { pingFrequencySeconds });
      const mockClient = new MockClient(wsServer);

      await mockClient.use(async () => {
        const connectionDate = new Date();

        jest.advanceTimersByTime(pingFrequencyMs + 1);
        const [ping1] = mockClient.incomingPings;
        const ping1ExpectedDate = addSeconds(connectionDate, pingFrequencySeconds);
        expect(ping1.date).toBeAfter(subMilliseconds(ping1ExpectedDate, 100));
        expect(ping1.date).toBeBefore(addMilliseconds(ping1ExpectedDate, 100));

        jest.advanceTimersByTime(pingFrequencyMs);
        const [, ping2] = mockClient.incomingPings;
        const ping2ExpectedDate = addSeconds(connectionDate, pingFrequencySeconds * 2);
        expect(ping2.date).toBeAfter(subMilliseconds(ping2ExpectedDate, 100));
        expect(ping2.date).toBeBefore(addMilliseconds(ping2ExpectedDate, 100));
      });
    });

    test('Ping should be logged', async () => {
      const wsServer = makeWebSocketServer(noOpWsHandler, { pingFrequencySeconds });
      const mockClient = new MockClient(wsServer);

      await mockClient.use(async () => {
        jest.advanceTimersByTime(pingFrequencyMs + 1);
        expect(mockLogs).toContainEqual(partialPinoLog('trace', 'Sending ping to client'));
      });
    });

    test('Pings should stop when connection is closed', async () => {
      const wsServer = makeWebSocketServer(noOpWsHandler, { pingFrequencySeconds });
      const mockClient = new MockClient(wsServer);

      await mockClient.connect();
      mockClient.close();

      jest.advanceTimersByTime(pingFrequencyMs + 1);

      expect(mockClient.incomingPings).toHaveLength(0);
    });
  });

  async function wsHandler(connectionStream: Duplex, socket: WebSocket): Promise<void> {
    socket.on('message', (message) => {
      connectionStream.write(message);
    });

    setImmediate(() => socket.close());
  }
});
