import { CogRPCClient } from '@relaycorp/cogrpc';
import {
  CargoCollectionAuthorization,
  CargoCollectionRequest,
  issueGatewayCertificate,
  PrivateKeyStore,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { addDays, differenceInSeconds, subMinutes } from 'date-fns';
import { v4 as getDefaultGateway } from 'default-gateway';
import { waitUntilUsedOnHost } from 'tcp-port-used';
import { Inject, Service } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DBPrivateKeyStore } from '../../keystores/DBPrivateKeyStore';
import { sleepSeconds } from '../../utils/timing';
import { GatewayRegistrar } from '../publicGateway/GatewayRegistrar';
import { PublicGateway } from '../publicGateway/PublicGateway';
import { DisconnectedFromCourierError, UnregisteredGatewayError } from './errors';

export const COURIER_PORT = 21473;
const COURIER_CHECK_TIMEOUT_MS = 3_000;
const COURIER_CHECK_RETRY_MS = 500;

const DELAY_BETWEEN_COLLECTION_AND_DELIVERY_SECONDS = 5;

export enum CourierConnectionStatus {
  DISCONNECTED,
  CONNECTED,
}

export enum CourierSyncStage {
  COLLECTION = 'COLLECTION',
  WAIT = 'WAIT',
  DELIVERY = 'DELIVERY',
}

const CLOCK_DRIFT_TOLERANCE_MINUTES = 90;
const OUTBOUND_CARGO_TTL_DAYS = 14;

@Service()
export class CourierSync {
  constructor(
    @Inject() protected gatewayRegistrar: GatewayRegistrar,
    @Inject() protected config: Config,
    @Inject(() => DBPrivateKeyStore) private privateKeyStore: PrivateKeyStore,
  ) {}

  public async *streamStatus(): AsyncIterable<CourierConnectionStatus> {
    let lastStatus: CourierConnectionStatus | null = null;
    while (true) {
      const newStatus = await this.getCourierConnectionStatus();
      if (newStatus !== lastStatus) {
        lastStatus = newStatus;
        yield newStatus;
      }
    }
  }

  /**
   * Synchronise with a courier.
   *
   * @throws UnregisteredGatewayError
   * @throws DisconnectedFromCourierError
   */
  public async *sync(): AsyncIterable<CourierSyncStage> {
    const publicGateway = await this.gatewayRegistrar.getPublicGateway();
    if (!publicGateway) {
      throw new UnregisteredGatewayError('Private gateway is unregistered');
    }

    const defaultGatewayIPAddress = await this.getDefaultGatewayIPAddress();
    const client = await CogRPCClient.init(`https://${defaultGatewayIPAddress}:${COURIER_PORT}`);
    try {
      yield CourierSyncStage.COLLECTION;
      await this.collectCargo(client, publicGateway);

      yield CourierSyncStage.WAIT;
      await sleepSeconds(DELAY_BETWEEN_COLLECTION_AND_DELIVERY_SECONDS);

      yield CourierSyncStage.DELIVERY;
    } finally {
      client.close();
    }
  }

  /**
   * Get the system's default gateway IPv4 address, if connected to a network.
   *
   * @throws DisconnectedFromCourierError if the default gateway couldn't be found (e.g., the
   *    device isn't connected to any network)
   */
  protected async getDefaultGatewayIPAddress(): Promise<string> {
    try {
      const { gateway: defaultGatewayIPAddress } = await getDefaultGateway();
      return defaultGatewayIPAddress;
    } catch (err) {
      throw new DisconnectedFromCourierError(err, 'Could not find default system gateway');
    }
  }

  protected async getCourierConnectionStatus(): Promise<CourierConnectionStatus> {
    let gatewayIPAddress: string;
    try {
      gatewayIPAddress = await this.getDefaultGatewayIPAddress();
    } catch (_) {
      return CourierConnectionStatus.DISCONNECTED;
    }
    try {
      await waitUntilUsedOnHost(
        COURIER_PORT,
        gatewayIPAddress,
        COURIER_CHECK_RETRY_MS,
        COURIER_CHECK_TIMEOUT_MS,
      );
    } catch (_) {
      return CourierConnectionStatus.DISCONNECTED;
    }
    return CourierConnectionStatus.CONNECTED;
  }

  private async collectCargo(client: CogRPCClient, publicGateway: PublicGateway): Promise<void> {
    const ccaSerialized = await this.generateCCA(publicGateway);
    await client.collectCargo(ccaSerialized);
  }

  private async generateCCA(publicGateway: PublicGateway): Promise<Buffer> {
    const now = new Date();
    const startDate = subMinutes(now, CLOCK_DRIFT_TOLERANCE_MINUTES);
    const endDate = addDays(now, OUTBOUND_CARGO_TTL_DAYS);

    const recipientAddress = `https://${publicGateway.publicAddress}`;
    const nodeKeyId = await this.config.get(ConfigKey.NODE_KEY_SERIAL_NUMBER);
    const nodeKey = await this.privateKeyStore.fetchNodeKey(Buffer.from(nodeKeyId!, 'hex'));
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
}
