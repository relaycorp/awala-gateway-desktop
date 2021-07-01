import { Signer } from '@relaycorp/relaynet-core';
import { RefusedParcelError, ServerError } from '@relaycorp/relaynet-poweb';
import bufferToArray from 'buffer-to-arraybuffer';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex } from 'stream';
import { source } from 'stream-to-it';
import { Container } from 'typedi';

import { DBPrivateKeyStore } from '../../../keystores/DBPrivateKeyStore';
import { ParcelStore, ParcelWithExpiryDate } from '../../../parcelStore';
import { LOGGER } from '../../../tokens';
import { MessageDirection } from '../../../utils/MessageDirection';
import { GatewayRegistrar } from '../GatewayRegistrar';
import { makeGSCClient } from '../gscClient';

export default async function runParcelDelivery(parentStream: Duplex): Promise<number> {
  const gatewayRegistrar = Container.get(GatewayRegistrar);
  const publicGateway = await gatewayRegistrar.getPublicGateway();
  if (!publicGateway) {
    // The gateway isn't registered.
    return 1;
  }

  const parcelStore = Container.get(ParcelStore);
  const logger = Container.get(LOGGER);

  logger.info('Ready to deliver parcels');
  await pipe(async function* (): AsyncIterable<string> {
    // Deliver the queued parcels before delivering parcels streamed by the parent process
    yield* await convertParcelsWithExpiryDateToParcelKeys(parcelStore.listInternetBound());
    yield* source(parentStream);
  }, await deliverParcels(publicGateway.publicAddress, parcelStore, logger));

  // This should never end, so ending "normally" should actually be an error
  return 2;
}

async function deliverParcels(
  publicGatewayAddress: string,
  parcelStore: ParcelStore,
  logger: Logger,
): Promise<(parcelKeys: AsyncIterable<string>) => Promise<void>> {
  const gcsClient = await makeGSCClient(publicGatewayAddress);

  const privateKeyStore = Container.get(DBPrivateKeyStore);
  const currentKey = await privateKeyStore.getCurrentKey();

  const signer = new Signer(currentKey!.certificate, currentKey!.privateKey);

  return async (parcelKeys: AsyncIterable<string>) => {
    for await (const parcelKey of parcelKeys) {
      logger.info({ parcelKey }, 'Retrieving parcel'); // TODO: REMOVE
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
          parcelAwareLogger.info('About to delete parcel in subprocess'); // TODO: REMOVE
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
