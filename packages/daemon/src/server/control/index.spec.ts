import { FastifyInstance } from 'fastify';

import { mockSpy } from '../../testUtils/jest';
import registerControlRoutes, { CONTROL_API_PREFIX } from './index';
import internetGatewayRoutes from './internetGateway';

const mockFastify: FastifyInstance = {
  register: mockSpy(jest.fn()),
} as any;

test('Internet gateway routes should be loaded', async () => {
  const options = { foo: 'bar' };

  await registerControlRoutes(mockFastify, options as any);

  expect(mockFastify.register).toBeCalledWith(internetGatewayRoutes, {
    ...options,
    prefix: CONTROL_API_PREFIX,
  });
});
