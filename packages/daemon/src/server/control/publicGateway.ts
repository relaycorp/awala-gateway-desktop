import { PublicAddressingError } from '@relaycorp/relaynet-core';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import isValidDomain from 'is-valid-domain';
import { Container } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { GatewayRegistrar } from '../../sync/publicGateway/GatewayRegistrar';
import { NonExistingAddressError } from '../../sync/publicGateway/gscClient';
import { getBearerTokenFromAuthHeader } from '../../utils/auth';
import RouteOptions from '../RouteOptions';

enum ErrorCode {
  ADDRESS_RESOLUTION_FAILURE = 'ADDRESS_RESOLUTION_FAILURE',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  MALFORMED_ADDRESS = 'MALFORMED_ADDRESS',
  REGISTRATION_FAILURE = 'REGISTRATION_FAILURE',
}

const ENDPOINT_PATH = '/public-gateway';

export default async function registerRoutes(
  fastify: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const config = Container.get(Config);
  const registrar = Container.get(GatewayRegistrar);

  fastify.route<{ readonly Body: string }>({
    method: 'GET',
    onRequest: makeAuthEnforcementHook(options.controlAuthToken),
    url: ENDPOINT_PATH,
    async handler(_request, reply): Promise<FastifyReply<any>> {
      const registeredAddress = await config.get(ConfigKey.PUBLIC_GATEWAY_ADDRESS);
      const publicAddress = registeredAddress ?? DEFAULT_PUBLIC_GATEWAY;
      return reply.header('Content-Type', 'application/json').code(200).send({ publicAddress });
    },
  });

  fastify.route<{ readonly Body: string }>({
    method: 'PUT',
    onRequest: makeAuthEnforcementHook(options.controlAuthToken),
    url: ENDPOINT_PATH,
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
        return abortFailedMigration(err, request, publicAddress, reply);
      }

      request.log.info({ publicAddress }, 'Gateway migration completed');
      return reply.header('Content-Type', 'application/json').code(204).send({});
    },
  });
}

function abortFailedMigration(
  err: Error,
  request: FastifyRequest<{ readonly Body: string }>,
  publicAddress: any,
  reply: FastifyReply<any>,
): FastifyReply<any> {
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

function makeAuthEnforcementHook(
  authToken: string,
): (
  request: FastifyRequest<{ readonly Body: string }>,
  reply: FastifyReply<any>,
  done: () => void,
) => void {
  return (request, reply, done): void => {
    const bearerToken = getBearerTokenFromAuthHeader(request.headers.authorization);
    if (bearerToken !== authToken) {
      request.log.warn('Refusing unauthenticated request');
      reply.code(401).send({});
    }

    done();
  };
}
