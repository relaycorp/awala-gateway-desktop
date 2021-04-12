import { MAX_RAMF_MESSAGE_LENGTH } from '@relaycorp/relaynet-core';
import { fastify, FastifyInstance } from 'fastify';
import pino from 'pino';

import { getMockContext, getMockInstance, mockSpy } from '../testUtils/jest';
import controlRoutes from './control';
import { disableCors } from './cors';
import { makeServer, runServer } from './index';

const mockFastify: FastifyInstance = {
  addHook: mockSpy(jest.fn()),
  listen: mockSpy(jest.fn()),
  ready: mockSpy(jest.fn()),
  register: mockSpy(jest.fn()),
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
