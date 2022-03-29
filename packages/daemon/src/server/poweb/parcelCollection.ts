import {
  Certificate,
  HandshakeChallenge,
  HandshakeResponse,
  ParcelCollectionHandshakeVerifier,
  ParcelDelivery,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex } from 'stream';
import { duplex } from 'stream-to-it';
import { Container } from 'typedi';
import uuid from 'uuid-random';
import WebSocket, { Server } from 'ws';

import { POWEB_API_PREFIX } from '.';
import { ParcelStore } from '../../parcelStore';
import { LOGGER } from '../../tokens';
import { MessageDirection } from '../../utils/MessageDirection';
import { makeWebSocketServer, WebSocketCode } from '../websocket';
import { PrivateGatewayManager } from '../../PrivateGatewayManager';

export const PATH = `${POWEB_API_PREFIX}/parcel-collection`;

const WEBSOCKET_PING_INTERVAL_SECONDS = 5;

export default function makeParcelCollectionServer(): Server {
  const logger = Container.get(LOGGER);
  const parcelStore = Container.get(ParcelStore);
  const gatewayManager = Container.get(PrivateGatewayManager);

  return makeWebSocketServer(
    async (connectionStream, socket, requestHeaders) => {
      const verifier = await gatewayManager.getVerifier(ParcelCollectionHandshakeVerifier);
      if (!verifier) {
        socket.close(WebSocketCode.SERVER_ERROR, 'Private gateway is currently unregistered');
        logger.info('Refusing parcel collection because private gateway is unregistered');
        return;
      }

      const endpointAddresses = await doHandshake(connectionStream, verifier, socket, logger);
      if (!endpointAddresses) {
        return;
      }
      const endpointAwareLogger = logger.child({ endpointAddresses });

      // "keep-alive" or any value other than "close-upon-completion" should keep the connection alive
      const keepAlive = requestHeaders['x-relaynet-streaming-mode'] !== 'close-upon-completion';

      const tracker = new CollectionTracker();
      try {
        await pipe(
          parcelStore.streamEndpointBound(endpointAddresses, keepAlive),
          makeDeliveryStream(parcelStore, tracker, socket, endpointAwareLogger),
          duplex(connectionStream),
          makeACKProcessor(parcelStore, tracker, socket, endpointAwareLogger),
        );
      } catch (err) {
        logger.error({ err }, 'Unexpected error');
      }
    },
    { pingFrequencySeconds: WEBSOCKET_PING_INTERVAL_SECONDS },
  );
}

async function doHandshake(
  connectionStream: Duplex,
  verifier: ParcelCollectionHandshakeVerifier,
  socket: WebSocket,
  logger: Logger,
): Promise<readonly string[] | null> {
  const nonce = bufferToArray(uuid.bin() as Buffer);
  const handshakeChallenge = new HandshakeChallenge(nonce);

  logger.debug('Sending handshake challenge');
  connectionStream.write(Buffer.from(handshakeChallenge.serialize()));

  const { value: handshakeRaw } = await connectionStream[Symbol.asyncIterator]().next();
  if (!handshakeRaw) {
    logger.debug('Client aborted handshake');
    socket.close(WebSocketCode.NORMAL, 'Handshake aborted');
    return null;
  }
  let handshakeResponse: HandshakeResponse;
  try {
    handshakeResponse = HandshakeResponse.deserialize(bufferToArray(handshakeRaw));
  } catch (err) {
    logger.info({ err }, 'Refusing malformed handshake response');
    socket.close(WebSocketCode.CANNOT_ACCEPT, 'Malformed handshake response');
    return null;
  }

  if (handshakeResponse.nonceSignatures.length === 0) {
    logger.info('Refusing handshake response with zero signatures');
    socket.close(WebSocketCode.CANNOT_ACCEPT, 'Handshake response does not include any signatures');
    return null;
  }

  let endpointCertificates: readonly Certificate[];
  try {
    endpointCertificates = await Promise.all(
      handshakeResponse.nonceSignatures.map((s) => verifier.verify(s, nonce)),
    );
  } catch (err) {
    logger.info({ err }, 'Refusing handshake response with malformed/invalid signatures');
    socket.close(
      WebSocketCode.CANNOT_ACCEPT,
      'Handshake response includes malformed/invalid signature(s)',
    );
    return null;
  }

  const endpointAddresses = await Promise.all(
    endpointCertificates.map((c) => c.calculateSubjectPrivateAddress()),
  );
  logger.debug({ endpointAddresses }, 'Handshake completed successfully');
  return endpointAddresses;
}

function makeDeliveryStream(
  parcelStore: ParcelStore,
  tracker: CollectionTracker,
  socket: WebSocket,
  logger: Logger,
): (parcelKeys: AsyncIterable<string>) => AsyncIterable<Buffer> {
  return async function* (parcelKeys): AsyncIterable<Buffer> {
    for await (const parcelKey of parcelKeys) {
      // TODO: Undo this. See https://github.com/relaycorp/awala-gateway-desktop/issues/365.
      // istanbul ignore next
      if (socket.readyState !== socket.OPEN) {
        // istanbul ignore next
        break;
      }

      const parcelSerialized = await parcelStore.retrieve(
        parcelKey,
        MessageDirection.FROM_INTERNET,
      );
      if (parcelSerialized) {
        logger.debug({ parcelKey }, 'Sending parcel');
        const delivery = new ParcelDelivery(uuid(), bufferToArray(parcelSerialized));
        tracker.addPendingACK(delivery.deliveryId, parcelKey);
        yield Buffer.from(delivery.serialize());
      } else {
        logger.debug({ parcelKey }, 'Skipping missing parcel');
      }
    }
    tracker.markAllParcelsDelivered();

    if (tracker.isCollectionComplete) {
      logger.debug('All parcels were acknowledged shortly after the last one was sent');
      socket.close(WebSocketCode.NORMAL);
    }
  };
}

function makeACKProcessor(
  parcelStore: ParcelStore,
  tracker: CollectionTracker,
  socket: WebSocket,
  logger: Logger,
): (ackMessages: AsyncIterable<Buffer>) => Promise<void> {
  return async (ackMessages) => {
    for await (const ackMessage of ackMessages) {
      const parcelKey = tracker.popPendingParcelKey(ackMessage.toString());
      if (!parcelKey) {
        logger.info('Closing connection due to unknown acknowledgement');
        socket.close(WebSocketCode.CANNOT_ACCEPT, 'Unknown delivery id sent as acknowledgement');
        break;
      }

      logger.info({ parcelKey }, 'Deleting acknowledged parcel');
      await parcelStore.delete(parcelKey, MessageDirection.FROM_INTERNET);

      if (tracker.isCollectionComplete) {
        logger.debug('All parcels have been collected and acknowledged');
        socket.close(WebSocketCode.NORMAL);
        break;
      }
    }
  };
}

class CollectionTracker {
  // tslint:disable-next-line:readonly-keyword
  private wereAllParcelsDelivered = false;
  // tslint:disable-next-line:readonly-keyword
  private pendingParcelKeyByDeliveryId: { [deliveryId: string]: string } = {};

  get isCollectionComplete(): boolean {
    return (
      this.wereAllParcelsDelivered && Object.keys(this.pendingParcelKeyByDeliveryId).length === 0
    );
  }

  public markAllParcelsDelivered(): void {
    // tslint:disable-next-line:no-object-mutation
    this.wereAllParcelsDelivered = true;
  }

  public addPendingACK(deliveryId: string, parcelKey: string): void {
    // tslint:disable-next-line:no-object-mutation
    this.pendingParcelKeyByDeliveryId[deliveryId] = parcelKey;
  }

  public popPendingParcelKey(deliveryId: string): string | undefined {
    const parcelKey = this.pendingParcelKeyByDeliveryId[deliveryId];
    if (parcelKey) {
      // tslint:disable-next-line:no-delete no-object-mutation
      delete this.pendingParcelKeyByDeliveryId[deliveryId];
    }
    return parcelKey;
  }
}
