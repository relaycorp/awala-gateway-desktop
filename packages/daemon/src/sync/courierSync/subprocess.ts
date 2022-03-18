import { CogRPCClient } from '@relaycorp/cogrpc';
import {
  Cargo,
  CargoDeliveryRequest,
  CargoMessageSet,
  CargoMessageStream,
  Certificate,
  CertificateRotation,
  Parcel,
  ParcelCollectionAck,
  PrivateGateway,
  PrivatePublicGatewayChannel,
  RecipientAddressType,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { v4 as getDefaultGateway } from 'default-gateway';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex } from 'stream';
import { Container } from 'typedi';
import { getRepository, Repository } from 'typeorm';
import uuid from 'uuid-random';

import { COURIER_PORT, CourierSyncExitCode, CourierSyncStage } from '.';
import { ParcelCollection } from '../../entity/ParcelCollection';
import { ParcelStore } from '../../parcelStore';
import { LOGGER } from '../../tokens';
import { MessageDirection } from '../../utils/MessageDirection';
import { sleepSeconds } from '../../utils/timing';
import { CourierSyncStageNotification, ParcelCollectionNotification } from './messaging';
import { PrivateGatewayManager } from '../../PrivateGatewayManager';
import { DBCertificateStore } from '../../keystores/DBCertificateStore';

const DELAY_BETWEEN_COLLECTION_AND_DELIVERY_SECONDS = 5;

export default async function runCourierSync(parentStream: Duplex): Promise<number> {
  const gatewayManager = Container.get(PrivateGatewayManager);
  const logger = Container.get(LOGGER);

  const channel = await gatewayManager.getCurrentChannelIfRegistered();
  if (!channel) {
    logger.fatal('Private gateway is unregistered');
    return CourierSyncExitCode.UNREGISTERED_GATEWAY;
  }

  let defaultGatewayIPAddress: string;
  try {
    const defaultGateway = await getDefaultGateway();
    defaultGatewayIPAddress = defaultGateway.gateway;
  } catch (err) {
    logger.fatal({ err }, 'System default gateway could not be found');
    return CourierSyncExitCode.FAILED_SYNC;
  }

  const parcelStore = Container.get(ParcelStore);
  const privateGateway = await gatewayManager.getCurrent();
  let client: CogRPCClient | null = null;
  try {
    client = await CogRPCClient.init(`https://${defaultGatewayIPAddress}:${COURIER_PORT}`);

    await collectCargo(channel, privateGateway, client, parcelStore, parentStream, logger);
    await waitBeforeDelivery(parentStream, logger);
    await deliverCargo(channel, client, parcelStore, parentStream, logger);
  } catch (err) {
    logger.fatal({ err }, 'Sync failed');
    return CourierSyncExitCode.FAILED_SYNC;
  } finally {
    client?.close();
  }

  logger.info('Sync completed successfully');
  return CourierSyncExitCode.OK;
}

async function collectCargo(
  channel: PrivatePublicGatewayChannel,
  privateGateway: PrivateGateway,
  client: CogRPCClient,
  parcelStore: ParcelStore,
  parentStream: Duplex,
  logger: Logger,
): Promise<void> {
  logger.debug('Starting cargo collection');
  sendStageNotificationToParent(parentStream, CourierSyncStage.COLLECTION);

  const certificateStore = Container.get(DBCertificateStore);

  const ccaSerialized = Buffer.from(await channel.generateCCA());
  await pipe(
    client.collectCargo(ccaSerialized),
    async (cargoesSerialized: AsyncIterable<Buffer>) => {
      const ownPDCCertificates = await certificateStore.retrieveAll(
        privateGateway.privateAddress,
        channel.peerPrivateAddress,
      );
      const ownCDAIssuers = await channel.getCDAIssuers();

      const parcelCollectionRepo = getRepository(ParcelCollection);

      for await (const cargoSerialized of cargoesSerialized) {
        let cargo: Cargo;
        try {
          cargo = await Cargo.deserialize(bufferToArray(cargoSerialized));
        } catch (err) {
          logger.warn({ err }, 'Ignoring malformed/invalid cargo');
          continue;
        }
        const cargoAwareLogger = logger.child({ cargo: { id: cargo.id } });

        try {
          await cargo.validate(RecipientAddressType.PRIVATE, ownCDAIssuers);
        } catch (err) {
          cargoAwareLogger.warn({ err }, 'Ignoring cargo by unauthorized sender');
          continue;
        }

        let cargoMessageSet: CargoMessageSet;
        try {
          cargoMessageSet = await privateGateway.unwrapMessagePayload(cargo);
        } catch (err) {
          cargoAwareLogger.warn({ err }, 'Ignored invalid message in cargo');
          continue;
        }

        cargoAwareLogger.debug('Processing collected cargo');

        for (const itemSerialized of cargoMessageSet.messages) {
          let item: Parcel | ParcelCollectionAck | CertificateRotation;
          try {
            item = await CargoMessageSet.deserializeItem(itemSerialized);
          } catch (err) {
            cargoAwareLogger.warn({ err }, 'Ignoring invalid/malformed message');
            continue;
          }
          if (item instanceof Parcel) {
            await processParcel(
              item,
              itemSerialized,
              parcelStore,
              ownPDCCertificates,
              parcelCollectionRepo,
              parentStream,
              cargoAwareLogger,
            );
          } else if (item instanceof ParcelCollectionAck) {
            await processParcelCollectionAck(item, parcelStore, cargoAwareLogger);
          } else {
            cargoAwareLogger.info('Certificate rotations are not yet supported');
          }
        }
      }
    },
  );
}

async function processParcel(
  parcel: Parcel,
  parcelSerialized: ArrayBuffer,
  parcelStore: ParcelStore,
  ownCertificates: readonly Certificate[],
  parcelCollectionRepo: Repository<ParcelCollection>,
  parentStream: Duplex,
  logger: Logger,
): Promise<void> {
  try {
    await parcel.validate(RecipientAddressType.PRIVATE, ownCertificates);
  } catch (err) {
    logger.warn({ err }, 'Ignoring invalid parcel');
    return;
  }
  const parcelKey = await parcelStore.storeEndpointBound(Buffer.from(parcelSerialized), parcel);

  const collection = parcelCollectionRepo.create({
    parcelExpiryDate: parcel.expiryDate,
    parcelId: parcel.id,
    recipientEndpointAddress: parcel.recipientAddress,
    senderEndpointPrivateAddress: await parcel.senderCertificate.calculateSubjectPrivateAddress(),
  });
  await parcelCollectionRepo.save(collection);

  if (parcelKey) {
    const notification: ParcelCollectionNotification = {
      parcelKey,
      recipientAddress: parcel.recipientAddress,
      type: 'parcelCollection',
    };
    parentStream.write(notification);
  }

  logger.info(
    { parcel: { id: parcel.id, key: parcelKey, recipientAddress: parcel.recipientAddress } },
    'Stored parcel',
  );
}

async function processParcelCollectionAck(
  ack: ParcelCollectionAck,
  parcelStore: ParcelStore,
  logger: Logger,
): Promise<void> {
  logger.info(
    {
      parcel: {
        id: ack.parcelId,
        recipientAddress: ack.recipientEndpointAddress,
        senderAddress: ack.senderEndpointPrivateAddress,
      },
    },
    'Deleting ACKed parcel',
  );
  await parcelStore.deleteInternetBoundFromACK(ack);
}

async function waitBeforeDelivery(parentStream: Duplex, logger: Logger): Promise<void> {
  logger.debug('Waiting before delivering cargo');
  sendStageNotificationToParent(parentStream, CourierSyncStage.WAIT);
  await sleepSeconds(DELAY_BETWEEN_COLLECTION_AND_DELIVERY_SECONDS);
}

async function deliverCargo(
  channel: PrivatePublicGatewayChannel,
  client: CogRPCClient,
  parcelStore: ParcelStore,
  parentStream: Duplex,
  logger: Logger,
): Promise<void> {
  logger.debug('Starting cargo delivery');
  sendStageNotificationToParent(parentStream, CourierSyncStage.DELIVERY);

  const cargoDeliveryStream = makeCargoDeliveryStream(channel, parcelStore, logger);
  await pipe(
    client.deliverCargo(cargoDeliveryStream),
    async (ackDeliveryIds: AsyncIterable<string>) => {
      for await (const ackDeliveryId of ackDeliveryIds) {
        logger.debug(
          { localDeliveryId: ackDeliveryId },
          'Received parcel delivery acknowledgement',
        );
      }
    },
  );
}

async function* makeCargoDeliveryStream(
  channel: PrivatePublicGatewayChannel,
  parcelStore: ParcelStore,
  logger: Logger,
): AsyncIterable<CargoDeliveryRequest> {
  const cargoStream = channel.generateCargoes(makeCargoMessageStream(parcelStore, logger));
  yield* await pipe(
    cargoStream,
    async function* (
      cargoesSerialized: AsyncIterable<Buffer>,
    ): AsyncIterable<CargoDeliveryRequest> {
      for await (const cargoSerialized of cargoesSerialized) {
        const localId = uuid();
        logger.info(
          { cargo: { octets: cargoSerialized.byteLength }, localDeliveryId: localId },
          'Delivering cargo',
        );
        yield { cargo: cargoSerialized, localId };
      }
    },
  );
}

async function* makeCargoMessageStream(
  parcelStore: ParcelStore,
  logger: Logger,
): CargoMessageStream {
  const collectionRepo = getRepository(ParcelCollection);
  const pendingACKs = await collectionRepo.find();
  for (const pendingACK of pendingACKs) {
    const ack = new ParcelCollectionAck(
      pendingACK.senderEndpointPrivateAddress,
      pendingACK.recipientEndpointAddress,
      pendingACK.parcelId,
    );
    logger.debug(
      {
        parcelCollectionAck: {
          parcelExpiryDate: pendingACK.parcelExpiryDate,
          parcelId: pendingACK.parcelId,
          recipientEndpointAddress: pendingACK.recipientEndpointAddress,
          senderEndpointPrivateAddress: pendingACK.senderEndpointPrivateAddress,
        },
      },
      'Adding parcel collection acknowledgement to cargo',
    );
    yield { message: Buffer.from(ack.serialize()), expiryDate: pendingACK.parcelExpiryDate };
  }

  for await (const parcelWithExpiryDate of parcelStore.listInternetBound()) {
    const parcelSerialized = await parcelStore.retrieve(
      parcelWithExpiryDate.parcelKey,
      MessageDirection.TOWARDS_INTERNET,
    );
    if (parcelSerialized) {
      logger.debug(
        {
          parcel: {
            expiryDate: parcelWithExpiryDate.expiryDate,
            key: parcelWithExpiryDate.parcelKey,
          },
        },
        'Adding parcel to cargo',
      );
      yield { message: parcelSerialized, expiryDate: parcelWithExpiryDate.expiryDate };
    } else {
      logger.debug({ parcel: { key: parcelWithExpiryDate.parcelKey } }, 'Skipped deleted parcel');
    }
  }
}

function sendStageNotificationToParent(parentStream: Duplex, stage: CourierSyncStage): void {
  const stageNotification: CourierSyncStageNotification = {
    stage,
    type: 'stage',
  };
  parentStream.write(stageNotification);
}
