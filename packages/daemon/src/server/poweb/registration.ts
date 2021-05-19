import { FastifyInstance, FastifyReply } from 'fastify';
import { Container } from 'typedi';

import { EndpointRegistrar, InvalidRegistrationRequestError } from '../../endpoints/registration';
import { registerAllowedMethods } from '../http';
import RouteOptions from '../RouteOptions';
import { CONTENT_TYPES } from './contentTypes';

const ENDPOINT_URL = '/nodes';

export default async function registerRoutes(
  fastify: FastifyInstance,
  _options: RouteOptions,
): Promise<void> {
  registerAllowedMethods(['POST'], ENDPOINT_URL, fastify);

  fastify.addContentTypeParser(
    CONTENT_TYPES.GATEWAY_REGISTRATION.REQUEST,
    { parseAs: 'buffer' },
    async (_req: any, rawBody: Buffer) => rawBody,
  );

  const endpointRegistrar = Container.get(EndpointRegistrar);

  fastify.route<{ readonly Body: Buffer }>({
    method: 'POST',
    url: ENDPOINT_URL,
    async handler(request, reply): Promise<FastifyReply<any>> {
      if (request.headers['content-type'] !== CONTENT_TYPES.GATEWAY_REGISTRATION.REQUEST) {
        return reply.code(415).send();
      }

      let registrationSerialized: Buffer;
      try {
        registrationSerialized = await endpointRegistrar.completeRegistration(request.body);
      } catch (err) {
        if (err instanceof InvalidRegistrationRequestError) {
          request.log.warn('Refusing registration due to malformed/invalid request');
          return reply.code(400).send({ message: 'Registration request is malformed/invalid' });
        }

        request.log.error({ err }, 'Endpoint registration failed');
        return reply.code(500).send({ message: 'Internal server error' });
      }

      request.log.info('Completed endpoint registration');
      return reply
        .header('Content-Type', CONTENT_TYPES.GATEWAY_REGISTRATION.REGISTRATION)
        .send(registrationSerialized);
    },
  });
}
