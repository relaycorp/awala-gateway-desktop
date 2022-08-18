import {
  GSCClient,
  Parcel,
  ParcelCollection,
  ParcelCollectionHandshakeSigner,
  InternetAddressingError,
  StreamingMode,
  UnreachableResolverError,
} from '@relaycorp/relaynet-core';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex, Writable } from 'stream';
import { Container } from 'typedi';

import { ParcelStore } from '../../../parcelStore';
import { LOGGER } from '../../../tokens';
import { sleepSeconds } from '../../../utils/timing';
import { makeGSCClient } from '../gscClient';
import { ParcelCollectionNotification, ParcelCollectorStatus } from './messaging';
import { PrivateGatewayManager } from '../../../PrivateGatewayManager';

export default async function runParcelCollection(parentStream: Duplex): Promise<number> {
  const logger = Container.get(LOGGER);

  const gatewayManager = Container.get(PrivateGatewayManager);
  const channel = await gatewayManager.getCurrentChannelIfRegistered();
  if (!channel) {
    logger.fatal('Private gateway is not registered');
    return 1;
  }

  notifyStatusToParent('disconnected', parentStream);

  logger.info('Ready to collect parcels');

  const privateGateway = await gatewayManager.getCurrent();
  const signer = await privateGateway.getGSCSigner(channel.peerId, ParcelCollectionHandshakeSigner);
  await pipe(
    await streamParcelCollections(
      channel.internetGatewayInternetAddress,
      signer!,
      parentStream,
      logger,
    ),
    processParcels(logger, parentStream),
  );

  // This should never end, so ending "normally" should actually be an error
  logger.fatal('Parcel collection ended unexpectedly');
  return 2;
}

async function streamParcelCollections(
  publicGatewayAddress: string,
  signer: ParcelCollectionHandshakeSigner,
  parentStream: Duplex,
  logger: Logger,
): Promise<() => AsyncIterable<ParcelCollection>> {
  const handshakeCallback = () => {
    logger.debug('Handshake completed successfully');
  };

  return async function* (): AsyncIterable<ParcelCollection> {
    let hasCollectionFailed = false;
    do {
      const gscClient = await makeGSCClientAndRetryIfNeeded(
        publicGatewayAddress,
        parentStream,
        logger,
      );
      hasCollectionFailed = false;
      try {
        yield* await gscClient.collectParcels(
          [signer],
          StreamingMode.KEEP_ALIVE,
          handshakeCallback,
        );
      } catch (err) {
        hasCollectionFailed = true;
        logger.warn({ err }, 'Collection failed; will retry...');
      }
    } while (hasCollectionFailed);
  };
}

async function makeGSCClientAndRetryIfNeeded(
  publicGatewayAddress: string,
  parentStream: Duplex,
  logger: Logger,
): Promise<GSCClient> {
  let client: GSCClient | null = null;
  while (client === null) {
    try {
      client = await makeGSCClient(publicGatewayAddress);
    } catch (err) {
      notifyStatusToParent('disconnected', parentStream);
      if (err instanceof UnreachableResolverError) {
        // Don't log the actual error because it'll waste disk space and won't add anything
        logger.debug('DNS resolver is unreachable');
        await sleepSeconds(3);
      } else if (err instanceof InternetAddressingError) {
        logger.error({ err }, 'Failed to resolve DNS record for public gateway');
        await sleepSeconds(30);
      } else {
        logger.error({ err, publicGatewayAddress }, 'Public gateway does not appear to exist');
        await sleepSeconds(60);
      }
    }
  }

  notifyStatusToParent('connected', parentStream);
  return client;
}

function processParcels(
  logger: Logger,
  parentStream: Duplex,
): (parcelCollections: AsyncIterable<ParcelCollection>) => Promise<void> {
  const parcelStore = Container.get(ParcelStore);

  return async (parcelCollections) => {
    for await (const collection of parcelCollections) {
      let parcel: Parcel;
      try {
        parcel = await collection.deserializeAndValidateParcel();
      } catch (err) {
        await collection.ack();
        logger.info({ err }, 'Ignored malformed/invalid parcel');
        continue;
      }

      const parcelKey = await parcelStore.storeEndpointBound(
        Buffer.from(collection.parcelSerialized),
        parcel,
      );
      await collection.ack();

      if (parcelKey) {
        const collectionMessage: ParcelCollectionNotification = {
          parcelKey,
          recipientAddress: parcel.recipient.id,
          type: 'parcelCollection',
        };
        parentStream.write(collectionMessage);
      }
      logger.info(
        { parcel: { id: parcel.id, key: parcelKey, recipientAddress: parcel.recipient.id } },
        'Saved new parcel',
      );
    }
  };
}

function notifyStatusToParent(status: 'connected' | 'disconnected', parentStream: Writable): void {
  const message: ParcelCollectorStatus = { status, type: 'status' };
  parentStream.write(message);
}
