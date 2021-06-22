import { Parcel, ParcelCollection, Signer, StreamingMode } from '@relaycorp/relaynet-core';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex } from 'stream';
import { Container } from 'typedi';

import { DBPrivateKeyStore } from '../../../keystores/DBPrivateKeyStore';
import { ParcelDirection, ParcelStore } from '../../../parcelStore';
import { LOGGER } from '../../../tokens';
import { GatewayRegistrar } from '../GatewayRegistrar';
import { makeGSCClient } from '../gscClient';

export default async function runParcelCollection(parentStream: Duplex): Promise<number> {
  const gatewayRegistrar = Container.get(GatewayRegistrar);
  const publicGateway = await gatewayRegistrar.getPublicGateway();
  if (!publicGateway) {
    // The gateway isn't registered.
    return 1;
  }
  const gscClient = await makeGSCClient(publicGateway.publicAddress);

  const logger = Container.get(LOGGER);
  logger.info('Ready to collect parcels');

  const privateKeyStore = Container.get(DBPrivateKeyStore);
  const currentKey = await privateKeyStore.getCurrentKey();
  const signer = new Signer(currentKey!.certificate, currentKey!.privateKey);
  const parcelCollections = gscClient.collectParcels([signer], StreamingMode.KEEP_ALIVE, () => {
    parentStream.write({ type: 'status', status: 'connected' });
  });
  await pipe(parcelCollections, processParcels(logger));

  // This should never end, so ending "normally" should actually be an error
  return 2;
}

function processParcels(
  logger: Logger,
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

      await parcelStore.store(
        Buffer.from(collection.parcelSerialized),
        parcel,
        ParcelDirection.INTERNET_TO_ENDPOINT,
      );
      await collection.ack();
      logger.info(
        { parcel: { id: parcel.id, recipient: parcel.recipientAddress } },
        'Saved new parcel',
      );
    }
  };
}
