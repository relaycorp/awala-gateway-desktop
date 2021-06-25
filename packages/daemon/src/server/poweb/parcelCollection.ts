import {
  Certificate,
  DETACHED_SIGNATURE_TYPES,
  HandshakeChallenge,
  HandshakeResponse,
  ParcelDelivery,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex } from 'stream';
import { duplex } from 'stream-to-it';
import { Container } from 'typedi';
import uuid from 'uuid-random';
import WebSocket, { createWebSocketStream, Server } from 'ws';

import { DBPrivateKeyStore } from '../../keystores/DBPrivateKeyStore';
import { ParcelDirection, ParcelStore } from '../../parcelStore';
import { LOGGER } from '../../tokens';
import { makeWebSocketServer, WebSocketCode } from '../websocket';

export default function makeParcelCollectionServer(): Server {
  const logger = Container.get(LOGGER);
  const parcelStore = Container.get(ParcelStore);

  return makeWebSocketServer(async (connectionStream, socket, requestHeaders) => {
    const endpointAddresses = await doHandshake(connectionStream, socket, logger);
    if (!endpointAddresses) {
      return;
    }

    // "keep-alive" or any value other than "close-upon-completion" should keep the connection alive
    const keepAlive = requestHeaders['x-relaynet-streaming-mode'] !== 'close-upon-completion';
    await pipe(
      parcelStore.streamActiveBoundForEndpoints(endpointAddresses, keepAlive),
      makeDeliveryStream(parcelStore, logger),
      duplex(createWebSocketStream(socket)),
    );
  });
}

async function doHandshake(
  connectionStream: Duplex,
  socket: WebSocket,
  logger: Logger,
): Promise<readonly string[] | null> {
  const nonce = bufferToArray(uuid.bin() as Buffer);
  const handshakeChallenge = new HandshakeChallenge(nonce);

  const privateKeyStore = Container.get(DBPrivateKeyStore);
  const ownCertificates = await privateKeyStore.fetchNodeCertificates();

  return new Promise((resolve) => {
    socket.once('message', async (message: Buffer) => {
      let handshakeResponse: HandshakeResponse;
      try {
        handshakeResponse = HandshakeResponse.deserialize(bufferToArray(message));
      } catch (err) {
        logger.info({ err }, 'Refusing malformed handshake response');
        socket.close(WebSocketCode.CANNOT_ACCEPT, 'Malformed handshake response');
        return resolve(null);
      }

      if (handshakeResponse.nonceSignatures.length === 0) {
        logger.info('Refusing handshake response with zero signatures');
        socket.close(
          WebSocketCode.CANNOT_ACCEPT,
          'Handshake response does not include any signatures',
        );
        return resolve(null);
      }

      let endpointCertificates: readonly Certificate[];
      try {
        endpointCertificates = await verifyNonceSignatures(
          handshakeResponse.nonceSignatures,
          nonce,
          ownCertificates,
        );
      } catch (err) {
        logger.info({ err }, 'Refusing handshake response with malformed/invalid signatures');
        socket.close(
          WebSocketCode.CANNOT_ACCEPT,
          'Handshake response includes malformed/invalid signature(s)',
        );
        return resolve(null);
      }

      const endpointAddresses = await Promise.all(
        endpointCertificates.map((c) => c.calculateSubjectPrivateAddress()),
      );
      logger.debug({ endpointAddresses }, 'Handshake completed successfully');
      resolve(endpointAddresses);
    });

    logger.debug('Sending handshake challenge');
    connectionStream.write(Buffer.from(handshakeChallenge.serialize()));
  });
}

function makeDeliveryStream(
  parcelStore: ParcelStore,
  logger: Logger,
): (parcelKeys: AsyncIterable<string>) => AsyncIterable<Buffer> {
  return async function* (parcelKeys): AsyncIterable<Buffer> {
    for await (const parcelKey of parcelKeys) {
      const parcelSerialized = await parcelStore.retrieve(
        parcelKey,
        ParcelDirection.INTERNET_TO_ENDPOINT,
      );
      if (parcelSerialized) {
        logger.debug({ parcelKey }, 'Sending parcel');
        const delivery = new ParcelDelivery(uuid(), bufferToArray(parcelSerialized));
        yield Buffer.from(delivery.serialize());
      } else {
        logger.debug({ parcelKey }, 'Skipping missing parcel');
      }
    }
  };
}

async function verifyNonceSignatures(
  nonceSignatures: readonly ArrayBuffer[],
  nonce: ArrayBuffer,
  ownCertificates: readonly Certificate[],
): Promise<readonly Certificate[]> {
  // tslint:disable-next-line:readonly-array
  const endpointCertificates: Certificate[] = [];
  for (const nonceSignature of nonceSignatures) {
    const endpointCertificate = await DETACHED_SIGNATURE_TYPES.NONCE.verify(
      nonceSignature,
      nonce,
      ownCertificates,
    );
    endpointCertificates.push(endpointCertificate);
  }
  return endpointCertificates;
}
