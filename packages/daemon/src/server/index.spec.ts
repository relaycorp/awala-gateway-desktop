import { MAX_RAMF_MESSAGE_LENGTH } from '@relaycorp/relaynet-core';
import { fastify, FastifyInstance } from 'fastify';
import { Container } from 'typedi';
import uuid from 'uuid-random';
import WebSocket from 'ws';

import { getMockContext, getMockInstance, mockSpy } from '../testUtils/jest';
import { mockLoggerToken } from '../testUtils/logging';
import { makeProcessSendMock } from '../testUtils/process';
import { LOGGER } from '../tokens';
import controlRoutes, { CONTROL_API_PREFIX } from './control';
import makeConnectionStatusServer from './control/connectionStatus';
import makeCourierSyncServer from './control/courierSync';
import { disableCors } from './cors';
import { makeServer, runServer } from './index';
import powebRoutes from './poweb';
import RouteOptions from './RouteOptions';
import { WebsocketServerFactory } from './websocket';

jest.mock('./control/connectionStatus');
jest.mock('./control/courierSync');

const mockFastify: FastifyInstance = {
  addHook: mockSpy(jest.fn()),
  listen: mockSpy(jest.fn()),
  ready: mockSpy(jest.fn()),
  register: mockSpy(jest.fn()),
  server: {
    on: mockSpy(jest.fn()),
  },
} as any;
jest.mock('fastify', () => {
  return { fastify: jest.fn().mockImplementation(() => mockFastify) };
});

afterAll(() => {
  jest.restoreAllMocks();
});

mockLoggerToken();

const mockProcessSend = makeProcessSendMock();

describe('makeServer', () => {
  test('Logger should be honoured', async () => {
    await makeServer();

    const logger = Container.get(LOGGER);
    expect(fastify).toBeCalledWith(expect.objectContaining({ logger }));
  });

  test('Maximum request body should allow for the largest RAMF message', async () => {
    await makeServer();

    const fastifyCallArgs = getMockContext(fastify).calls[0];
    expect(fastifyCallArgs[0]).toHaveProperty('bodyLimit', MAX_RAMF_MESSAGE_LENGTH);
  });

  test('CORS should be disabled', async () => {
    await makeServer();

    expect(mockFastify.addHook).toBeCalledWith('onRequest', disableCors);
  });

  test('Control routes should be loaded', async () => {
    await makeServer();

    expect(mockFastify.register).toBeCalledWith(
      controlRoutes,
      expect.toSatisfy((options: RouteOptions) => uuid.test(options.controlAuthToken)),
    );
  });

  test('PoWeb routes should be loaded', async () => {
    await makeServer();

    expect(mockFastify.register).toBeCalledWith(powebRoutes, expect.anything());
  });

  test('Routes should be "awaited" for', async () => {
    const error = new Error('Denied');
    getMockInstance(mockFastify.register).mockImplementation((plugin) => {
      if (plugin === controlRoutes) {
        throw error;
      }
    });

    await expect(makeServer()).rejects.toEqual(error);
  });

  test('It should wait for the Fastify server to be ready', async () => {
    await makeServer();

    expect(mockFastify.ready).toBeCalledTimes(1);
  });

  test('Server instance should be returned', async () => {
    const serverInstance = await makeServer();

    expect(serverInstance).toBe(mockFastify);
  });

  describe('Control auth token', () => {
    test('Token should be shared with parent if process was forked', async () => {
      let passedMessage: any;
      mockProcessSend((message: any) => {
        passedMessage = message;
        return true;
      });

      await makeServer();

      expect(passedMessage).toBeTruthy();
      expect(passedMessage).toHaveProperty('type', 'controlAuthToken');
      expect(passedMessage).toHaveProperty(
        'value',
        expect.toSatisfy((t) => uuid.test(t)),
      );
    });

    test('Any explicit token should be honoured', async () => {
      const token = 'the-auth-token';
      let passedMessage: any;
      mockProcessSend((message: any) => {
        passedMessage = message;
        return true;
      });

      await makeServer(token);

      expect(passedMessage).toBeTruthy();
      expect(passedMessage).toHaveProperty('value', token);
    });

    test('Token should not be shared if process was not forked', async () => {
      await makeServer();
    });
  });
});

describe('runServer', () => {
  test('Server returned by makeServer() should be used', async () => {
    await runServer(mockFastify);

    expect(mockFastify.listen).toBeCalledTimes(1);
  });

  test('Server should listen on port 13276', async () => {
    await runServer(mockFastify);

    const listenCallArgs = getMockContext(mockFastify.listen).calls[0];
    expect(listenCallArgs[0]).toHaveProperty('port', 13276);
  });

  test('Server should listen on 127.0.0.1', async () => {
    await runServer(mockFastify);

    expect(mockFastify.listen).toBeCalledTimes(1);
    const listenCallArgs = getMockContext(mockFastify.listen).calls[0];
    expect(listenCallArgs[0]).toHaveProperty('host', '127.0.0.1');
  });

  test('listen() call should be "awaited" for', async () => {
    const error = new Error('Denied');
    getMockInstance(mockFastify.listen).mockRejectedValueOnce(error);

    await expect(runServer(mockFastify)).rejects.toEqual(error);
  });
});

describe('WebSocket servers', () => {
  test('Connection status should be mounted on /_control/sync-status', async () => {
    await expectWebsocketServerToBeMounted(
      makeConnectionStatusServer,
      `${CONTROL_API_PREFIX}/sync-status`,
    );
  });

  test('Courier sync should be mounted on /_control/courier-sync', async () => {
    await expectWebsocketServerToBeMounted(
      makeCourierSyncServer,
      `${CONTROL_API_PREFIX}/courier-sync`,
    );
  });

  test('Unrecognised paths should result in the socket destroyed', async () => {
    const mockWSServer = mockWebsocketServer();
    getMockInstance(makeConnectionStatusServer).mockReturnValue(mockWSServer);
    const fastifyInstance = await makeServer();
    const mockRequest = { url: '/non-existing' };
    const mockSocket = { destroy: jest.fn() };

    const upgradeHandler = getMockContext(fastifyInstance.server.on).calls[0][1];

    upgradeHandler(mockRequest, mockSocket, {});

    expect(mockSocket.destroy).toBeCalled();
    expect(mockWSServer.handleUpgrade).not.toBeCalled();
  });

  async function expectWebsocketServerToBeMounted(
    websocketServerFactory: WebsocketServerFactory,
    websocketEndpointPath: string,
  ): Promise<void> {
    const mockWSServer = mockWebsocketServer();
    getMockInstance(websocketServerFactory).mockReturnValue(mockWSServer);
    const fastifyInstance = await makeServer();
    const mockRequest = { url: `${websocketEndpointPath}?auth=secret` };
    const mockSocket = { what: 'the socket' };
    const mockHeaders = { key: 'value' };

    expect(fastifyInstance.server.on).toBeCalledWith('upgrade', expect.any(Function));
    const upgradeHandler = getMockContext(fastifyInstance.server.on).calls[0][1];

    upgradeHandler(mockRequest, mockSocket, mockHeaders);

    expect(mockWSServer.handleUpgrade).toBeCalledWith(
      mockRequest,
      mockSocket,
      mockHeaders,
      expect.any(Function),
    );
    const preUpgradeHandler = getMockContext(mockWSServer.handleUpgrade).calls[0][3];
    preUpgradeHandler(mockSocket);
    expect(mockWSServer.emit).toBeCalledWith('connection', mockSocket, mockRequest);
    expect(mockWSServer.handleUpgrade).toHaveBeenCalledBefore(mockWSServer.emit as any);

    expect(websocketServerFactory).toBeCalledWith(expect.toSatisfy((token) => uuid.test(token)));
  }
});

function mockWebsocketServer(): WebSocket.Server {
  return {
    emit: jest.fn(),
    handleUpgrade: jest.fn(),
  } as any;
}
