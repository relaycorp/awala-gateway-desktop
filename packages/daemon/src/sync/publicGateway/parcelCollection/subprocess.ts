import {
  GSCClient,
  Parcel,
  ParcelCollection,
  PublicAddressingError,
  Signer,
  StreamingMode,
} from '@relaycorp/relaynet-core';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex } from 'stream';
import { Container } from 'typedi';

import { DBPrivateKeyStore } from '../../../keystores/DBPrivateKeyStore';
import { ParcelDirection, ParcelStore } from '../../../parcelStore';
import { LOGGER } from '../../../tokens';
import { sleepSeconds } from '../../../utils/timing';
import { GatewayRegistrar } from '../GatewayRegistrar';
import { makeGSCClient } from '../gscClient';
import { ParcelCollectionNotification, ParcelCollectorStatus } from './messaging';

export default async function runParcelCollection(parentStream: Duplex): Promise<number> {
  const logger = Container.get(LOGGER);

  const gatewayRegistrar = Container.get(GatewayRegistrar);
  const publicGateway = await gatewayRegistrar.getPublicGateway();
  if (!publicGateway) {
    logger.fatal('Private gateway is not registered');
    return 1;
  }

  logger.info('Ready to collect parcels');

  await pipe(
    await streamParcelCollections(publicGateway.publicAddress, parentStream, logger),
    processParcels(logger, parentStream),
  );

  // This should never end, so ending "normally" should actually be an error
  logger.fatal('Parcel collection ended unexpectedly');
  return 2;
}

async function streamParcelCollections(
  publicGatewayAddress: string,
  parentStream: Duplex,
  logger: Logger,
): Promise<() => AsyncIterable<ParcelCollection>> {
  const privateKeyStore = Container.get(DBPrivateKeyStore);
  const currentKey = await privateKeyStore.getCurrentKey();
  const signer = new Signer(currentKey!.certificate, currentKey!.privateKey);

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
      const disconnectedStatus: ParcelCollectorStatus = { type: 'status', status: 'disconnected' };
      parentStream.write(disconnectedStatus);
      if (err instanceof PublicAddressingError) {
        logger.info({ err }, 'Failed to resolve DNS record for public gateway');
        await sleepSeconds(3);
      } else {
        logger.warn({ err, publicGatewayAddress }, 'Public gateway does not appear to exist');
        await sleepSeconds(10);
      }
    }
  }

  const status: ParcelCollectorStatus = { type: 'status', status: 'connected' };
  parentStream.write(status);
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

      const parcelKey = await parcelStore.store(
        Buffer.from(collection.parcelSerialized),
        parcel,
        ParcelDirection.INTERNET_TO_ENDPOINT,
      );
      await collection.ack();

      const collectionMessage: ParcelCollectionNotification = {
        parcelKey,
        recipientAddress: parcel.recipientAddress,
        type: 'parcelCollection',
      };
      parentStream.write(collectionMessage);
      logger.info(
        { parcel: { id: parcel.id, recipientAddress: parcel.recipientAddress } },
        'Saved new parcel',
      );
    }
  };
}
