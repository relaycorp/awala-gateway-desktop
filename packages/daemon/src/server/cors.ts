import { FastifyReply, FastifyRequest } from 'fastify';

export async function disableCors(
  request: FastifyRequest,
  reply: FastifyReply<any>,
): Promise<void> {
  if ('origin' in request.headers) {
    return reply.code(400).send({ message: 'CORS requests are forbidden' });
  }
}
