import { FastifyInstance } from 'fastify';

import { mockSpy } from '../../testUtils/jest';
import registerControlRoutes from './index';
import publicGatewayRoutes from './publicGateway';

const mockFastify: FastifyInstance = {
  register: mockSpy(jest.fn()),
} as any;
jest.mock('fastify', () => {
  return { fastify: jest.fn().mockImplementation(() => mockFastify) };
});

test('Public gateway routes should be loaded', async () => {
  const options = { foo: 'bar' };

  await registerControlRoutes(mockFastify, options as any);

  expect(mockFastify.register).toBeCalledWith(publicGatewayRoutes, options);
});
