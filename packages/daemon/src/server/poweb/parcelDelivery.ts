import {
  Certificate,
  Parcel,
  ParcelDeliveryVerifier,
  RAMFSyntaxError,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { FastifyInstance, FastifyLoggerInstance, FastifyReply } from 'fastify';
import { Container } from 'typedi';

import { ParcelStore } from '../../parcelStore';
import { ParcelDeliveryManager } from '../../sync/publicGateway/parcelDelivery/ParcelDeliveryManager';
import { registerAllowedMethods } from '../http';
import RouteOptions from '../RouteOptions';
import { CONTENT_TYPES } from './contentTypes';
import { PrivateGatewayManager } from '../../PrivateGatewayManager';

const ENDPOINT_URL = '/parcels';

export default async function registerRoutes(
  fastify: FastifyInstance,
  _options: RouteOptions,
): Promise<void> {
  const parcelStore = Container.get(ParcelStore);
  const parcelDeliveryManager = Container.get(ParcelDeliveryManager);
  const gatewayManager = Container.get(PrivateGatewayManager);

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

      const verifier = await gatewayManager.getVerifier(ParcelDeliveryVerifier);
      if (!verifier) {
        request.log.info('Refusing parcel delivery because private gateway is unregistered');
        return reply.code(500).send({ message: 'Private gateway is currently unregistered' });
      }

      const countersignerCertificate = await verifyCountersignature(
        request.body,
        request.headers.authorization,
        request.log,
        verifier,
      );
      if (!countersignerCertificate) {
        return reply
          .code(401)
          .header('www-authenticate', 'Relaynet-Countersignature')
          .send({ message: 'Parcel delivery countersignature is either missing or invalid' });
      }

      let parcel: Parcel;
      try {
        parcel = await parseAndValidateParcel(request.body);
      } catch (err) {
        return replyWithParcelRejection(err as Error, reply, request.log);
      }

      let parcelKey: string;
      try {
        parcelKey = await parcelStore.storeInternetBound(request.body, parcel);
      } catch (err) {
        request.log.error({ err }, 'Failed to store parcel');
        return reply.code(500).send({ message: 'Internal server error' });
      }

      parcelDeliveryManager.notifyAboutNewParcel(parcelKey);
      request.log.info('Parcel was successfully saved');
      return reply.code(202).send({ message: 'Parcel is well-formed but invalid' });
    },
  });
}

async function parseAndValidateParcel(parcelSerialized: Buffer): Promise<Parcel> {
  const parcel = await Parcel.deserialize(bufferToArray(parcelSerialized));
  await parcel.validate();
  return parcel;
}

function replyWithParcelRejection(
  error: Error,
  reply: FastifyReply<any>,
  logger: FastifyLoggerInstance,
): FastifyReply<any> {
  const errorAwareLogger = logger.child({ err: error });

  let statusCode: number;
  let message: string;
  if (error instanceof RAMFSyntaxError) {
    statusCode = 400;
    message = 'Parcel is malformed';
    errorAwareLogger.info('Rejected malformed parcel');
  } else {
    statusCode = 422;
    message = 'Parcel is well-formed but invalid';
    errorAwareLogger.info('Rejected invalid parcel');
  }
  return reply.code(statusCode).send({ message });
}

async function verifyCountersignature(
  parcelSerialized: ArrayBuffer,
  authorizationHeader: string | undefined,
  logger: FastifyLoggerInstance,
  verifier: ParcelDeliveryVerifier,
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
  try {
    return await verifier.verify(bufferToArray(countersignature), parcelSerialized);
  } catch (err) {
    logger.debug({ err }, 'Invalid countersignature');
    return null;
  }
}
