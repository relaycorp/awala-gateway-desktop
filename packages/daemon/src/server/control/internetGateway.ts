import { InternetAddressingError, UnreachableResolverError } from '@relaycorp/relaynet-core';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import isValidDomain from 'is-valid-domain';
import { Container } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_INTERNET_GATEWAY_ADDRESS } from '../../constants';
import { GatewayRegistrar } from '../../sync/internetGateway/GatewayRegistrar';
import { ParcelCollectorManager } from '../../sync/internetGateway/parcelCollection/ParcelCollectorManager';
import { getBearerTokenFromAuthHeader } from '../../utils/auth';
import RouteOptions from '../RouteOptions';
import { NonExistingAddressError } from '../../sync/internetGateway/errors';

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
  const parcelCollectorManager = Container.get(ParcelCollectorManager);

  fastify.route<{ readonly Body: string }>({
    method: 'GET',
    onRequest: makeAuthEnforcementHook(options.controlAuthToken),
    url: ENDPOINT_PATH,
    async handler(_request, reply): Promise<FastifyReply<any>> {
      const registeredAddress = await config.get(ConfigKey.INTERNET_GATEWAY_ADDRESS);
      const internetAddress = registeredAddress ?? DEFAULT_INTERNET_GATEWAY_ADDRESS;
      return reply.header('Content-Type', 'application/json').code(200).send({ internetAddress });
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

      const internetAddress = (request.body as any).internetAddress?.replace(/\.$/, '');

      if (!isValidDomain(internetAddress)) {
        request.log.warn({ internetAddress }, 'Malformed Internet address');
        return reply
          .header('Content-Type', 'application/json')
          .code(400)
          .send({ code: ErrorCode.MALFORMED_ADDRESS });
      }

      try {
        await registrar.register(internetAddress);
      } catch (err) {
        return abortFailedMigration(err as Error, request, internetAddress, reply);
      }

      await parcelCollectorManager.restart();
      request.log.info({ internetAddress }, 'Gateway migration completed');
      return reply.header('Content-Type', 'application/json').code(204).send({});
    },
  });
}

function abortFailedMigration(
  err: Error,
  request: FastifyRequest<{ readonly Body: string }>,
  internetAddress: any,
  reply: FastifyReply<any>,
): FastifyReply<any> {
  const statusCode = err instanceof NonExistingAddressError ? 400 : 500;
  const baseResponse = reply.header('Content-Type', 'application/json').code(statusCode);
  if (err instanceof NonExistingAddressError) {
    request.log.warn({ internetAddress }, 'Internet address does not exist');
    return baseResponse.send({ code: ErrorCode.INVALID_ADDRESS });
  } else if (err instanceof UnreachableResolverError) {
    request.log.warn('Failed to reach DNS resolver');
    return baseResponse.send({ code: ErrorCode.ADDRESS_RESOLUTION_FAILURE });
  } else if (err instanceof InternetAddressingError) {
    request.log.warn({ err, internetAddress }, 'Failed to resolve Internet address');
    return baseResponse.send({ code: ErrorCode.ADDRESS_RESOLUTION_FAILURE });
  }
  request.log.warn({ err, internetAddress }, 'Failed to complete registration');
  return baseResponse.send({ code: ErrorCode.REGISTRATION_FAILURE });
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
