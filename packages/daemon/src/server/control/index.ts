import { FastifyInstance } from 'fastify';

import RouteOptions from '../RouteOptions';
import publicGatewayRoutes from './publicGateway';

export default async function registerRoutes(
  fastify: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  await fastify.register(publicGatewayRoutes, { ...options, prefix: '/_control' });
}

export const CONTROL_API_PREFIX = '/_control';
