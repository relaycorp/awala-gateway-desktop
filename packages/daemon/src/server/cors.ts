import { FastifyReply, FastifyRequest } from 'fastify';

import { CONTROL_API_PREFIX } from './control';

export async function disableCors(
  request: FastifyRequest,
  reply: FastifyReply<any>,
): Promise<void> {
  const isControlAPI = request.url.startsWith(CONTROL_API_PREFIX + '/');
  if (!isControlAPI && 'origin' in request.headers) {
    return reply.code(400).send({ message: 'CORS requests are forbidden' });
  }
}
