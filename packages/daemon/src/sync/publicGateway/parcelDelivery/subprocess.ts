import { Signer } from '@relaycorp/relaynet-core';
import { RefusedParcelError, ServerError } from '@relaycorp/relaynet-poweb';
import bufferToArray from 'buffer-to-arraybuffer';
import pipe from 'it-pipe';
import { Duplex } from 'stream';
import { source } from 'stream-to-it';
import { Container } from 'typedi';

import { DBPrivateKeyStore } from '../../../keystores/DBPrivateKeyStore';
import { ParcelDirection, ParcelStore } from '../../../parcelStore';
import { LOGGER } from '../../../tokens';
import { makeParentStream } from '../../../utils/subprocess/parent';
import { GatewayRegistrar } from '../GatewayRegistrar';
import { makeGSCClient } from '../gscClient';

export default async function runParcelCollection(_parentStream: Duplex): Promise<number> {
  const gatewayRegistrar = Container.get(GatewayRegistrar);
  const publicGateway = await gatewayRegistrar.getPublicGateway();
  if (!publicGateway) {
    // The gateway isn't registered.
    return 1;
  }
  const gcsClient = await makeGSCClient(publicGateway.publicAddress);

  const parcelStore = Container.get(ParcelStore);
  const logger = Container.get(LOGGER);

  async function deliverParcels(parcelKeys: AsyncIterable<string>): Promise<void> {
    const privateKeyStore = Container.get(DBPrivateKeyStore);
    const currentKey = await privateKeyStore.getCurrentKey();
    const signer = new Signer(currentKey!.certificate, currentKey!.privateKey);
    for await (const parcelKey of parcelKeys) {
      const parcelSerialized = await parcelStore.retrieve(
        parcelKey,
        ParcelDirection.ENDPOINT_TO_INTERNET,
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
          await parcelStore.delete(parcelKey, ParcelDirection.ENDPOINT_TO_INTERNET);
        }
      } else {
        parcelAwareLogger.info('Skipping non-existing parcel');
      }
    }
  }

  logger.info('Ready to deliver parcels');
  const parentStream = await makeParentStream();
  await pipe(async function* (): AsyncIterable<string> {
    // Deliver the queued parcels before delivering parcels streamed by the parent process
    yield* await parcelStore.listActiveBoundForInternet();
    yield* source(parentStream);
  }, deliverParcels);

  // This should never end, so ending "normally" should actually be an error
  return 2;
}
