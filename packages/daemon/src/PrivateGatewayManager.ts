import {
  ParcelCollectionHandshakeVerifier,
  ParcelDeliveryVerifier,
  PrivateGatewayManager as BasePrivateGatewayManager,
  PrivateInternetGatewayChannel,
} from '@relaycorp/relaynet-core';
import { Inject, Service } from 'typedi';

import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import { DBPublicKeyStore } from './keystores/DBPublicKeyStore';
import { DBCertificateStore } from './keystores/DBCertificateStore';
import { Config, ConfigKey } from './Config';
import { MissingGatewayError, UnregisteredGatewayError } from './errors';
import { PrivateGateway } from './PrivateGateway';

type Verifier = ParcelDeliveryVerifier | ParcelCollectionHandshakeVerifier;

@Service()
export class PrivateGatewayManager extends BasePrivateGatewayManager {
  constructor(
    @Inject() privateKeyStore: DBPrivateKeyStore,
    @Inject() publicKeyStore: DBPublicKeyStore,
    @Inject() certificateStore: DBCertificateStore,
    @Inject() protected readonly config: Config,
  ) {
    super({ certificateStore, privateKeyStore, publicKeyStore });
  }

  /**
   * Return an instance of the current `PrivateGateway`.
   *
   * @throws {MissingGatewayError}
   */
  public async getCurrent(): Promise<PrivateGateway> {
    const id = await this.config.get(ConfigKey.CURRENT_ID);
    if (!id) {
      throw new MissingGatewayError('Config does not contain current id');
    }
    const existingGateway = await this.get(id, PrivateGateway);
    if (!existingGateway) {
      throw new MissingGatewayError(`Private key (${id}) is missing`);
    }
    return existingGateway;
  }

  public async createCurrentIfMissing(): Promise<void> {
    const currentNodeId = await this.config.get(ConfigKey.CURRENT_ID);

    if (currentNodeId) {
      const privateKey = await this.keyStores.privateKeyStore.retrieveIdentityKey(currentNodeId);
      if (privateKey) {
        return;
      }
    }

    const { id } = await this.keyStores.privateKeyStore.generateIdentityKeyPair();
    await this.config.set(ConfigKey.CURRENT_ID, id);
  }

  /**
   * Return the channel with the Internet gateway.
   *
   * @throws {MissingGatewayError} if the private gateway isn't initialised
   * @throws {UnregisteredGatewayError} if the private gateway isn't registered with Internet gateway
   */
  public async getCurrentChannel(): Promise<PrivateInternetGatewayChannel> {
    const privateGateway = await this.getCurrent();

    const internetGatewayId = await this.config.get(ConfigKey.INTERNET_GATEWAY_ID);
    if (!internetGatewayId) {
      throw new UnregisteredGatewayError('Private gateway is unregistered');
    }

    const internetGatewayAddress = await this.config.get(ConfigKey.INTERNET_GATEWAY_ADDRESS);
    const channel = await privateGateway.retrieveInternetGatewayChannel(
      internetGatewayId,
      internetGatewayAddress!,
    );
    if (!channel) {
      throw new UnregisteredGatewayError('Failed to retrieve channel; some keys may be missing');
    }

    return channel;
  }

  /**
   * Return the channel with the Internet gateway or `null` if the private gateway is unregistered.
   *
   * @throws {MissingGatewayError} if the private gateway isn't initialised
   */
  public async getCurrentChannelIfRegistered(): Promise<PrivateInternetGatewayChannel | null> {
    try {
      return await this.getCurrentChannel();
    } catch (err) {
      if (err instanceof UnregisteredGatewayError) {
        return null;
      }
      throw err;
    }
  }

  public async getVerifier<V extends Verifier>(
    verifierClass: new (...args: readonly any[]) => V,
  ): Promise<V | null> {
    const internetGatewayId = await this.config.get(ConfigKey.INTERNET_GATEWAY_ID);
    if (!internetGatewayId) {
      return null;
    }

    const privateGateway = await this.getCurrent();
    return privateGateway.getGSCVerifier(internetGatewayId, verifierClass);
  }
}
