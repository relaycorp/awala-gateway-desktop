import {
  generateRSAKeyPair,
  getPrivateAddressFromIdentityKey,
  ParcelCollectionHandshakeVerifier,
  ParcelDeliveryVerifier,
  PrivateGateway,
  PrivateGatewayManager as BasePrivateGatewayManager,
  PrivatePublicGatewayChannel,
} from '@relaycorp/relaynet-core';
import { Inject, Service } from 'typedi';

import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import { DBPublicKeyStore } from './keystores/DBPublicKeyStore';
import { DBCertificateStore } from './keystores/DBCertificateStore';
import { Config, ConfigKey } from './Config';
import { MissingGatewayError, UnregisteredGatewayError } from './errors';

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
    const privateAddress = await this.config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS);
    if (!privateAddress) {
      throw new MissingGatewayError('Config does not contain current private address');
    }
    const existingGateway = await this.get(privateAddress);
    if (!existingGateway) {
      throw new MissingGatewayError(`Private key (${privateAddress}) is missing`);
    }
    return existingGateway;
  }

  public async createCurrentIfMissing(): Promise<void> {
    const currentNodePrivateAddress = await this.config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS);

    if (currentNodePrivateAddress) {
      const privateKey = await this.keyStores.privateKeyStore.retrieveIdentityKey(
        currentNodePrivateAddress,
      );
      if (privateKey) {
        return;
      }
    }

    const keyPair = await generateRSAKeyPair();
    await this.keyStores.privateKeyStore.saveIdentityKey(keyPair.privateKey!);
    const privateAddress = await getPrivateAddressFromIdentityKey(keyPair.publicKey!);
    await this.config.set(ConfigKey.CURRENT_PRIVATE_ADDRESS, privateAddress);
  }

  /**
   * Return the channel with the public gateway.
   *
   * @throws {MissingGatewayError} if the private gateway isn't initialised
   * @throws {UnregisteredGatewayError} if the private gateway isn't registered with public gateway
   */
  public async getCurrentChannel(): Promise<PrivatePublicGatewayChannel> {
    const privateGateway = await this.getCurrent();

    const publicGatewayPrivateAddress = await this.config.get(
      ConfigKey.PUBLIC_GATEWAY_PRIVATE_ADDRESS,
    );
    if (!publicGatewayPrivateAddress) {
      throw new UnregisteredGatewayError('Private gateway is unregistered');
    }

    const publicGatewayPublicAddress = await this.config.get(ConfigKey.PUBLIC_GATEWAY_ADDRESS);
    const channel = await privateGateway.retrievePublicGatewayChannel(
      publicGatewayPrivateAddress,
      publicGatewayPublicAddress!,
    );
    if (!channel) {
      throw new UnregisteredGatewayError('Failed to retrieve channel; some keys may be missing');
    }

    return channel;
  }
  /**
   * Return the channel with the public gateway or `null` if the private gateway is unregistered.
   *
   * @throws {MissingGatewayError} if the private gateway isn't initialised
   */
  public async getCurrentChannelIfRegistered(): Promise<PrivatePublicGatewayChannel | null> {
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
    const publicGatewayPrivateAddress = await this.config.get(
      ConfigKey.PUBLIC_GATEWAY_PRIVATE_ADDRESS,
    );
    if (!publicGatewayPrivateAddress) {
      return null;
    }

    const privateGateway = await this.getCurrent();
    return privateGateway.getGSCVerifier(publicGatewayPrivateAddress, verifierClass);
  }
}
