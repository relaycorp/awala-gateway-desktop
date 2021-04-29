import { FastifyInstance } from 'fastify';

import { registerDisallowedMethods } from '../http';
import RouteOptions from '../RouteOptions';

const ENDPOINT_URL = '/nodes';

export default async function registerRoutes(
  fastify: FastifyInstance,
  _options: RouteOptions,
): Promise<void> {
  registerDisallowedMethods(['POST'], ENDPOINT_URL, fastify);
}
