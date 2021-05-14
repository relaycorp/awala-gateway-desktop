import { FastifyInstance } from 'fastify';

import { registerAllowedMethods } from '../http';
import RouteOptions from '../RouteOptions';

const ENDPOINT_URL = '/parcels';

export default async function registerRoutes(
  fastify: FastifyInstance,
  _options: RouteOptions,
): Promise<void> {
  registerAllowedMethods(['POST'], ENDPOINT_URL, fastify);
}
