import { FastifyInstance, FastifyReply } from 'fastify';
import { Container } from 'typedi';

import { EndpointRegistrar, MalformedEndpointKeyDigestError } from '../../endpoints/registration';
import { registerDisallowedMethods } from '../http';
import RouteOptions from '../RouteOptions';
import { CONTENT_TYPES } from './contentTypes';

const ENDPOINT_URL = '/pre-registrations';

export default async function registerRoutes(
  fastify: FastifyInstance,
  _options: RouteOptions,
): Promise<void> {
  registerDisallowedMethods(['POST'], ENDPOINT_URL, fastify);

  const endpointRegistrar = Container.get(EndpointRegistrar);

  fastify.route<{ readonly Body: string }>({
    method: 'POST',
    url: ENDPOINT_URL,
    async handler(request, reply): Promise<FastifyReply<any>> {
      if (request.headers['content-type'] !== 'text/plain') {
        return reply.code(415).send();
      }
      const endpointPublicKeyDigest = request.body;

      let authorizationSerialized: Buffer;
      try {
        authorizationSerialized = await endpointRegistrar.preRegister(endpointPublicKeyDigest);
      } catch (err) {
        if (err instanceof MalformedEndpointKeyDigestError) {
          return reply.code(400).send({ message: 'Payload is not a SHA-256 digest' });
        }

        request.log.error(
          { endpointPublicKeyDigest, err },
          'Failed to authorize endpoint registration',
        );
        return reply.code(500).send({ message: 'Internal server error' });
      }

      request.log.info({ endpointPublicKeyDigest }, 'Endpoint registration authorized');
      return reply
        .header('Content-Type', CONTENT_TYPES.GATEWAY_REGISTRATION.AUTHORIZATION)
        .send(authorizationSerialized);
    },
  });
}
