import { FastifyInstance, FastifyPluginCallback } from 'fastify';

import RouteOptions from '../RouteOptions';
import parcelDeliveryRoutes from './parcelDelivery';
import preRegistrationRoutes from './preRegistration';
import registrationRoutes from './registration';

export const POWEB_API_PREFIX = '/v1';

const ROUTES: ReadonlyArray<FastifyPluginCallback<RouteOptions>> = [
  parcelDeliveryRoutes,
  preRegistrationRoutes,
  registrationRoutes,
];

export default async function registerPoWebRoutes(
  fastify: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const finalOptions = { ...options, prefix: POWEB_API_PREFIX };
  await Promise.all(ROUTES.map((route) => fastify.register(route, finalOptions)));
}
