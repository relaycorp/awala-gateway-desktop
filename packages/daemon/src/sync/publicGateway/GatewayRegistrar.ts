import {
  generateRSAKeyPair,
  PrivateKeyStore,
  PrivateNodeRegistrationRequest,
} from '@relaycorp/relaynet-core';
import { Inject, Service } from 'typedi';

import { Config } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { DBPrivateKeyStore } from '../../keystores/DBPrivateKeyStore';
import { PUBLIC_GATEWAY_ADDRESS } from '../../tokens';
import { makeGSCClient } from './gscClient';

@Service()
export class GatewayRegistrar {
  constructor(
    @Inject(() => DBPrivateKeyStore) private privateKeyStore: PrivateKeyStore,
    private config: Config,
  ) {}

  /**
   * Register with the `publicGatewayAddress`.
   *
   * @param publicGatewayAddress
   * @throws PublicAddressingError if the DNS lookup or DNSSEC verification failed
   * @throws NonExistingAddressError if the DNS+DNSSEC lookup succeeded but the address doesn't exist
   */
  public async register(publicGatewayAddress: string): Promise<void> {
    const currentPublicGatewayAddress = await this.getPublicGatewayAddress();
    if (currentPublicGatewayAddress === publicGatewayAddress) {
      return;
    }

    const client = await makeGSCClient(publicGatewayAddress);

    const identityKeyPair = await generateRSAKeyPair();

    const registrationAuth = await client.preRegisterNode(identityKeyPair.publicKey);
    const registrationRequest = new PrivateNodeRegistrationRequest(
      identityKeyPair.publicKey,
      registrationAuth,
    );
    const registration = await client.registerNode(
      await registrationRequest.serialize(identityKeyPair.privateKey),
    );

    await this.privateKeyStore.saveNodeKey(
      identityKeyPair.privateKey,
      registration.privateNodeCertificate,
    );

    await this.config.set(PUBLIC_GATEWAY_ADDRESS, publicGatewayAddress);
  }

  public async registerIfUnregistered(): Promise<void> {
    const publicGatewayAddress = await this.getPublicGatewayAddress();
    if (!publicGatewayAddress) {
      await this.register(DEFAULT_PUBLIC_GATEWAY);
    }
  }

  private getPublicGatewayAddress(): Promise<string | null> {
    return this.config.get(PUBLIC_GATEWAY_ADDRESS);
  }
}
