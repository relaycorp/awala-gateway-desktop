import { FastifyInstance, FastifyPluginCallback } from 'fastify';

import { mockSpy } from '../../testUtils/jest';
import RouteOptions from '../RouteOptions';
import registerPoWebRoutes, { POWEB_API_PREFIX } from './index';
import preRegistrationRoutes from './preRegistration';
import registrationRoutes from './registration';

const ROUTES: ReadonlyArray<FastifyPluginCallback<RouteOptions>> = [
  preRegistrationRoutes,
  registrationRoutes,
];

const mockFastify: FastifyInstance = {
  register: mockSpy(jest.fn()),
} as any;

test('Routes should be loaded', async () => {
  const options = { foo: 'bar' };

  await registerPoWebRoutes(mockFastify, options as any);

  expect(mockFastify.register).toBeCalledTimes(ROUTES.length);
  ROUTES.forEach((routeFactory) => {
    expect(mockFastify.register).toBeCalledWith(routeFactory, {
      ...options,
      prefix: POWEB_API_PREFIX,
    });
  });
});
