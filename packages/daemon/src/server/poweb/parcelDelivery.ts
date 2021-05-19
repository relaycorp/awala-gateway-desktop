import { Certificate, DETACHED_SIGNATURE_TYPES } from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { FastifyInstance, FastifyLoggerInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Container } from 'typedi';

import { DBPrivateKeyStore } from '../../keystores/DBPrivateKeyStore';
import { InvalidParcelError, MalformedParcelError, ParcelStore } from '../../parcelStore';
import { registerAllowedMethods } from '../http';
import RouteOptions from '../RouteOptions';
import { CONTENT_TYPES } from './contentTypes';

const ENDPOINT_URL = '/parcels';

export default async function registerRoutes(
  fastify: FastifyInstance,
  _options: RouteOptions,
): Promise<void> {
  const privateKeyStore = Container.get(DBPrivateKeyStore);
  const parcelStore = Container.get(ParcelStore);

  registerAllowedMethods(['POST'], ENDPOINT_URL, fastify);

  fastify.addContentTypeParser(
    CONTENT_TYPES.PARCEL,
    { parseAs: 'buffer' },
    async (_req: any, rawBody: Buffer) => rawBody,
  );

  fastify.route<{ readonly Body: Buffer }>({
    method: ['POST'],
    url: ENDPOINT_URL,
    async handler(request, reply): Promise<FastifyReply<any>> {
      if (request.headers['content-type'] !== CONTENT_TYPES.PARCEL) {
        return reply.code(415).send();
      }

      const parcelSerialized = request.body;
      const countersignerCertificate = await verifyCountersignature(
        parcelSerialized,
        request.headers.authorization,
        request.log,
        privateKeyStore,
      );
      if (!countersignerCertificate) {
        return reply
          .code(401)
          .header('www-authenticate', 'Relaynet-Countersignature')
          .send({ message: 'Parcel delivery countersignature is either missing or invalid' });
      }

      try {
        await parcelStore.storeInternetBoundParcel(parcelSerialized);
      } catch (err) {
        return replyWithParcelRejection(err, request, reply);
      }

      request.log.info('Parcel was successfully saved');
      return reply.code(202).send({ message: 'Parcel is well-formed but invalid' });
    },
  });
}

function replyWithParcelRejection(
  err: Error,
  request: FastifyRequest<any>,
  reply: FastifyReply<any>,
): FastifyReply<any> {
  let statusCode: number;
  let message: string;
  if (err instanceof MalformedParcelError) {
    statusCode = 400;
    message = 'Parcel is malformed';
    request.log.info({ err }, 'Rejected malformed parcel');
  } else if (err instanceof InvalidParcelError) {
    statusCode = 422;
    message = 'Parcel is well-formed but invalid';
    request.log.info({ err }, 'Rejected invalid parcel');
  } else {
    statusCode = 500;
    message = 'Internal server error';
    request.log.error({ err }, 'Failed to store parcel');
  }
  return reply.code(statusCode).send({ message });
}

async function verifyCountersignature(
  parcelSerialized: ArrayBuffer,
  authorizationHeader: string | undefined,
  logger: FastifyLoggerInstance,
  privateKeyStore: DBPrivateKeyStore,
): Promise<Certificate | null> {
  const [authorizationType, countersignatureBase64] = (authorizationHeader || '').split(' ', 2);
  if (authorizationType !== 'Relaynet-Countersignature') {
    return null;
  }
  const countersignature = Buffer.from(countersignatureBase64, 'base64');
  if (countersignature.byteLength === 0) {
    // The base64-encoded countersignature was empty or malformed
    return null;
  }
  const trustedCertificates = await privateKeyStore.fetchNodeCertificates();
  try {
    return await DETACHED_SIGNATURE_TYPES.PARCEL_DELIVERY.verify(
      bufferToArray(countersignature),
      parcelSerialized,
      trustedCertificates,
    );
  } catch (err) {
    logger.debug({ err }, 'Invalid countersignature');
    return null;
  }
}
