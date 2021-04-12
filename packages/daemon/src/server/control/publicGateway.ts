import { PublicAddressingError } from '@relaycorp/relaynet-core';
import { FastifyInstance, FastifyReply } from 'fastify';
import isValidDomain from 'is-valid-domain';
import { Container } from 'typedi';

import { GatewayRegistrar } from '../../sync/publicGateway/GatewayRegistrar';
import { NonExistingAddressError } from '../../sync/publicGateway/gscClient';
import RouteOptions from '../RouteOptions';

enum ErrorCode {
  ADDRESS_RESOLUTION_FAILURE = 'ADDRESS_RESOLUTION_FAILURE',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  MALFORMED_ADDRESS = 'MALFORMED_ADDRESS',
  REGISTRATION_FAILURE = 'REGISTRATION_FAILURE',
}

export default async function registerRoutes(
  fastify: FastifyInstance,
  _options: RouteOptions,
): Promise<void> {
  const registrar = Container.get(GatewayRegistrar);

  fastify.route<{ readonly Body: string }>({
    method: 'PUT',
    url: '/public-gateway',
    async handler(request, reply): Promise<FastifyReply<any>> {
      if (request.headers['content-type'] !== 'application/json') {
        return reply.header('Content-Type', 'application/json').code(415).send({});
      }

      const publicAddress = (request.body as any).publicAddress?.replace(/\.$/, '');

      if (!isValidDomain(publicAddress)) {
        request.log.warn({ publicAddress }, 'Malformed public address');
        return reply
          .header('Content-Type', 'application/json')
          .code(400)
          .send({ code: ErrorCode.MALFORMED_ADDRESS });
      }

      try {
        await registrar.register(publicAddress);
      } catch (err) {
        if (err instanceof NonExistingAddressError) {
          request.log.warn({ publicAddress }, 'Public address does not exist');
          return reply
            .header('Content-Type', 'application/json')
            .code(400)
            .send({ code: ErrorCode.INVALID_ADDRESS });
        } else if (err instanceof PublicAddressingError) {
          request.log.warn({ err, publicAddress }, 'Failed to resolve public address');
          return reply
            .header('Content-Type', 'application/json')
            .code(500)
            .send({ code: ErrorCode.ADDRESS_RESOLUTION_FAILURE });
        }
        request.log.warn({ err, publicAddress }, 'Failed to complete registration');
        return reply
          .header('Content-Type', 'application/json')
          .code(500)
          .send({ code: ErrorCode.REGISTRATION_FAILURE });
      }

      request.log.info({ publicAddress }, 'Gateway migration completed');
      return reply.header('Content-Type', 'application/json').code(204).send({});
    },
  });
}
