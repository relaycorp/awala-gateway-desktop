import { MAX_RAMF_MESSAGE_LENGTH } from '@relaycorp/relaynet-core';
import { fastify, FastifyInstance } from 'fastify';
import pino from 'pino';
import WebSocket from 'ws';

import { getMockContext, getMockInstance, mockSpy } from '../testUtils/jest';
import controlRoutes from './control';
import makeConnectionStatusServer from './control/connectionStatus';
import { disableCors } from './cors';
import { makeServer, runServer } from './index';

jest.mock('./control/connectionStatus');

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

const customLogger = pino();

describe('makeServer', () => {
  test('Logger should be honoured', async () => {
    await makeServer(customLogger);

    expect(fastify).toBeCalledWith(
      expect.objectContaining({
        logger: customLogger,
      }),
    );
  });

  test('Maximum request body should allow for the largest RAMF message', async () => {
    await makeServer(customLogger);

    const fastifyCallArgs = getMockContext(fastify).calls[0];
    expect(fastifyCallArgs[0]).toHaveProperty('bodyLimit', MAX_RAMF_MESSAGE_LENGTH);
  });

  test('CORS should be disabled', async () => {
    await makeServer(customLogger);

    expect(mockFastify.addHook).toBeCalledWith('onRequest', disableCors);
  });

  test('Control routes should be loaded', async () => {
    await makeServer(customLogger);

    expect(mockFastify.register).toBeCalledWith(controlRoutes);
  });

  test('Routes should be "awaited" for', async () => {
    const error = new Error('Denied');
    getMockInstance(mockFastify.register).mockImplementation((plugin) => {
      if (plugin === controlRoutes) {
        throw error;
      }
    });

    await expect(makeServer(customLogger)).rejects.toEqual(error);
  });

  test('It should wait for the Fastify server to be ready', async () => {
    await makeServer(customLogger);

    expect(mockFastify.ready).toBeCalledTimes(1);
  });

  test('Server instance should be returned', async () => {
    const serverInstance = await makeServer(customLogger);

    expect(serverInstance).toBe(mockFastify);
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
    const mockWSServer = mockWebsocketServer();
    getMockInstance(makeConnectionStatusServer).mockReturnValue(mockWSServer);
    const fastifyInstance = await makeServer(customLogger);
    const mockRequest = { url: '/_control/sync-status' };
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

    expect(makeConnectionStatusServer).toBeCalledWith(customLogger);
  });

  test('Unrecognised paths should result in the socket destroyed', async () => {
    const mockWSServer = mockWebsocketServer();
    getMockInstance(makeConnectionStatusServer).mockReturnValue(mockWSServer);
    const fastifyInstance = await makeServer(customLogger);
    const mockRequest = { url: '/non-existing' };
    const mockSocket = { destroy: jest.fn() };

    const upgradeHandler = getMockContext(fastifyInstance.server.on).calls[0][1];

    upgradeHandler(mockRequest, mockSocket, {});

    expect(mockSocket.destroy).toBeCalled();
    expect(mockWSServer.handleUpgrade).not.toBeCalled();
  });
});

function mockWebsocketServer(): WebSocket.Server {
  return {
    emit: jest.fn(),
    handleUpgrade: jest.fn(),
  } as any;
}
