import { RefusedParcelError, ServerError } from '@relaycorp/relaynet-poweb';
import bufferToArray from 'buffer-to-arraybuffer';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex } from 'stream';
import { source } from 'stream-to-it';
import { Container } from 'typedi';

import { ParcelStore, ParcelWithExpiryDate } from '../../../parcelStore';
import { LOGGER } from '../../../tokens';
import { MessageDirection } from '../../../utils/MessageDirection';
import { makeGSCClient } from '../gscClient';
import { PrivateGatewayManager } from '../../../PrivateGatewayManager';
import { ParcelDeliverySigner } from '@relaycorp/relaynet-core';

export default async function runParcelDelivery(parentStream: Duplex): Promise<number> {
  const parcelStore = Container.get(ParcelStore);
  const logger = Container.get(LOGGER);

  const gatewayManager = Container.get(PrivateGatewayManager);
  const channel = await gatewayManager.getCurrentChannelIfRegistered();
  if (!channel) {
    logger.fatal('Private gateway is not registered');
    return 1;
  }

  async function* streamParcels(): AsyncIterable<string> {
    // Deliver the queued parcels before delivering parcels streamed by the parent process
    yield* await convertParcelsWithExpiryDateToParcelKeys(parcelStore.listInternetBound());
    yield* source(parentStream);
  }

  const privateGateway = await gatewayManager.getCurrent();
  const signer = await privateGateway.getGSCSigner(
    channel.peerPrivateAddress,
    ParcelDeliverySigner,
  );
  logger.info('Ready to deliver parcels');
  await pipe(
    streamParcels,
    await deliverParcels(channel.publicGatewayPublicAddress, signer!, parcelStore, logger),
  );

  // This should never end, so ending "normally" should actually be an error
  return 2;
}

async function deliverParcels(
  publicGatewayAddress: string,
  signer: ParcelDeliverySigner,
  parcelStore: ParcelStore,
  logger: Logger,
): Promise<(parcelKeys: AsyncIterable<string>) => Promise<void>> {
  const gcsClient = await makeGSCClient(publicGatewayAddress);

  return async (parcelKeys: AsyncIterable<string>) => {
    for await (const parcelKey of parcelKeys) {
      const parcelSerialized = await parcelStore.retrieve(
        parcelKey,
        MessageDirection.TOWARDS_INTERNET,
      );
      const parcelAwareLogger = logger.child({ parcelKey });
      if (parcelSerialized) {
        let deleteParcel = false;
        try {
          await gcsClient.deliverParcel(bufferToArray(parcelSerialized), signer);
          parcelAwareLogger.info('Delivered parcel');
          deleteParcel = true;
        } catch (err) {
          const errorAwareLogger = parcelAwareLogger.child({ err });
          if (err instanceof RefusedParcelError) {
            errorAwareLogger.info('Parcel was refused by the public gateway');
            deleteParcel = true;
          } else if (err instanceof ServerError) {
            errorAwareLogger.warn('Parcel delivery failed due to server error');
          } else {
            errorAwareLogger.fatal('Parcel delivery failed due to unexpected error');
          }
        }

        if (deleteParcel) {
          await parcelStore.delete(parcelKey, MessageDirection.TOWARDS_INTERNET);
        }
      } else {
        parcelAwareLogger.info('Skipping non-existing parcel');
      }
    }
  };
}

async function* convertParcelsWithExpiryDateToParcelKeys(
  parcelsWithExpiryDate: AsyncIterable<ParcelWithExpiryDate>,
): AsyncIterable<string> {
  for await (const parcelWithExpiryDate of parcelsWithExpiryDate) {
    yield parcelWithExpiryDate.parcelKey;
  }
}
