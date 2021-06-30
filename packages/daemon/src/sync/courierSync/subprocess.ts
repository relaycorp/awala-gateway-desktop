import { CogRPCClient } from '@relaycorp/cogrpc';
import {
  CargoCollectionAuthorization,
  CargoCollectionRequest,
  CargoDeliveryRequest,
  CargoMessageStream,
  Gateway,
  issueGatewayCertificate,
  ParcelCollectionAck,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { addDays, differenceInSeconds, subMinutes } from 'date-fns';
import { v4 as getDefaultGateway } from 'default-gateway';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex } from 'stream';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';
import uuid from 'uuid-random';

import { COURIER_PORT, CourierSyncExitCode, CourierSyncStage } from '.';
import { ParcelCollection } from '../../entity/ParcelCollection';
import { DBPrivateKeyStore } from '../../keystores/DBPrivateKeyStore';
import { DBPublicKeyStore } from '../../keystores/DBPublicKeyStore';
import { ParcelDirection, ParcelStore } from '../../parcelStore';
import { LOGGER } from '../../tokens';
import { sleepSeconds } from '../../utils/timing';
import { GatewayRegistrar } from '../publicGateway/GatewayRegistrar';
import { PublicGateway } from '../publicGateway/PublicGateway';
import { CourierSyncStageNotification } from './messaging';

const DELAY_BETWEEN_COLLECTION_AND_DELIVERY_SECONDS = 5;

const CLOCK_DRIFT_TOLERANCE_MINUTES = 90;
const OUTBOUND_CARGO_TTL_DAYS = 14;

export default async function runCourierSync(parentStream: Duplex): Promise<number> {
  const gatewayRegistrar = Container.get(GatewayRegistrar);
  const logger = Container.get(LOGGER);

  const publicGateway = await gatewayRegistrar.getPublicGateway();
  if (!publicGateway) {
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
  let client: CogRPCClient | null = null;
  try {
    client = await CogRPCClient.init(`https://${defaultGatewayIPAddress}:${COURIER_PORT}`);

    await collectCargo(publicGateway, client, parentStream, logger);

    sendStageNotificationToParent(parentStream, CourierSyncStage.WAIT);
    await sleepSeconds(DELAY_BETWEEN_COLLECTION_AND_DELIVERY_SECONDS);

    await deliverCargo(publicGateway, client, parcelStore, parentStream, logger);
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
  publicGateway: PublicGateway,
  client: CogRPCClient,
  parentStream: Duplex,
  _logger: Logger,
): Promise<void> {
  sendStageNotificationToParent(parentStream, CourierSyncStage.COLLECTION);

  const ccaSerialized = await generateCCA(publicGateway);
  await client.collectCargo(ccaSerialized);
}

async function generateCCA(publicGateway: PublicGateway): Promise<Buffer> {
  const now = new Date();
  const startDate = subMinutes(now, CLOCK_DRIFT_TOLERANCE_MINUTES);
  const endDate = addDays(now, OUTBOUND_CARGO_TTL_DAYS);

  const privateKeyStore = Container.get(DBPrivateKeyStore);
  const recipientAddress = `https://${publicGateway.publicAddress}`;
  const nodeKey = (await privateKeyStore.getCurrentKey())!;
  const ephemeralNodeCertificate = await issueGatewayCertificate({
    issuerPrivateKey: nodeKey.privateKey,
    subjectPublicKey: await nodeKey.certificate.getPublicKey(),
    validityEndDate: endDate,
    validityStartDate: startDate,
  });
  const cargoDeliveryAuthorization = await issueGatewayCertificate({
    issuerCertificate: ephemeralNodeCertificate,
    issuerPrivateKey: nodeKey.privateKey,
    subjectPublicKey: await publicGateway.identityCertificate.getPublicKey(),
    validityEndDate: ephemeralNodeCertificate.expiryDate,
  });
  const ccr = new CargoCollectionRequest(cargoDeliveryAuthorization);
  const ccaPayload = await SessionlessEnvelopedData.encrypt(
    await ccr.serialize(),
    publicGateway.identityCertificate,
  );
  const cca = new CargoCollectionAuthorization(
    recipientAddress,
    ephemeralNodeCertificate,
    Buffer.from(ccaPayload.serialize()),
    { creationDate: startDate, ttl: differenceInSeconds(endDate, startDate) },
  );
  const ccaSerialized = await cca.serialize(nodeKey.privateKey);
  return Buffer.from(ccaSerialized);
}

async function deliverCargo(
  publicGateway: PublicGateway,
  client: CogRPCClient,
  parcelStore: ParcelStore,
  parentStream: Duplex,
  logger: Logger,
): Promise<void> {
  sendStageNotificationToParent(parentStream, CourierSyncStage.DELIVERY);

  const cargoDeliveryStream = makeCargoDeliveryStream(publicGateway, parcelStore, logger);
  await pipe(client.deliverCargo(cargoDeliveryStream), async (ackIds: AsyncIterable<string>) => {
    for await (const ackId of ackIds) {
      logger.debug({ ackId }, 'Received parcel delivery acknowledgement');
    }
  });
}

async function* makeCargoDeliveryStream(
  publicGateway: PublicGateway,
  parcelStore: ParcelStore,
  logger: Logger,
): AsyncIterable<CargoDeliveryRequest> {
  const privateKeyStore = Container.get(DBPrivateKeyStore);
  const publicKeyStore = Container.get(DBPublicKeyStore);
  const gateway = new Gateway(privateKeyStore, publicKeyStore);
  const currentKey = (await privateKeyStore.getCurrentKey())!;
  const cargoStream = gateway.generateCargoes(
    makeCargoMessageStream(parcelStore, logger),
    publicGateway.identityCertificate,
    currentKey.privateKey,
    currentKey.certificate,
    `https://${publicGateway.publicAddress}`,
  );
  yield* await pipe(
    cargoStream,
    async function* (cargoes: AsyncIterable<Buffer>): AsyncIterable<CargoDeliveryRequest> {
      for await (const cargo of cargoes) {
        yield { cargo, localId: uuid() };
      }
    },
  );
}

async function* makeCargoMessageStream(
  parcelStore: ParcelStore,
  logger: Logger,
): CargoMessageStream {
  const collectionACKRepo = getRepository(ParcelCollection);
  const stream = await collectionACKRepo.find();
  for (const pendingAck of stream) {
    const ack = new ParcelCollectionAck(
      pendingAck.senderEndpointPrivateAddress,
      pendingAck.recipientEndpointAddress,
      pendingAck.parcelId,
    );
    yield { message: Buffer.from(ack.serialize()), expiryDate: pendingAck.parcelExpiryDate };
  }

  for await (const parcelWithExpiryDate of parcelStore.listInternetBound()) {
    const parcelSerialized = await parcelStore.retrieve(
      parcelWithExpiryDate.parcelKey,
      ParcelDirection.ENDPOINT_TO_INTERNET,
    );
    if (parcelSerialized) {
      yield { message: parcelSerialized, expiryDate: parcelWithExpiryDate.expiryDate };
    } else {
      logger.debug({ parcelKey: parcelWithExpiryDate.parcelKey }, 'Skipped deleted parcel');
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
