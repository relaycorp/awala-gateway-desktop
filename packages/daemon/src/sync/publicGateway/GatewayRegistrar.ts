import {
  Certificate,
  generateRSAKeyPair,
  PrivateKeyStore,
  PrivateNodeRegistrationRequest,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { Inject, Service } from 'typedi';

import { Config } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { FileStore } from '../../fileStore';
import { DBPrivateKeyStore } from '../../keystores/DBPrivateKeyStore';
import { PUBLIC_GATEWAY_ADDRESS } from '../../tokens';
import { makeGSCClient } from './gscClient';
import { PublicGateway } from './PublicGateway';

const PUBLIC_GATEWAY_ID_CERTIFICATE_OBJECT_KEY = 'public-gateway-id-certificate.der';

@Service()
export class GatewayRegistrar {
  constructor(
    @Inject(() => DBPrivateKeyStore) private privateKeyStore: PrivateKeyStore,
    private config: Config,
    @Inject() private fileStore: FileStore,
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
    await this.fileStore.putObject(
      Buffer.from(registration.gatewayCertificate.serialize()),
      PUBLIC_GATEWAY_ID_CERTIFICATE_OBJECT_KEY,
    );
  }

  public async registerIfUnregistered(): Promise<void> {
    const isRegistered = await this.isRegistered();
    if (!isRegistered) {
      await this.register(DEFAULT_PUBLIC_GATEWAY);
    }
  }

  public async isRegistered(): Promise<boolean> {
    const publicGatewayAddress = await this.getPublicGatewayAddress();
    return publicGatewayAddress !== null;
  }

  public async getPublicGateway(): Promise<PublicGateway | null> {
    const publicAddress = await this.getPublicGatewayAddress();
    const identityCertificateSerialized = await this.fileStore.getObject(
      PUBLIC_GATEWAY_ID_CERTIFICATE_OBJECT_KEY,
    );
    if (!publicAddress || !identityCertificateSerialized) {
      return null;
    }
    const identityCertificate = Certificate.deserialize(
      bufferToArray(identityCertificateSerialized),
    );
    return { publicAddress, identityCertificate };
  }

  private getPublicGatewayAddress(): Promise<string | null> {
    return this.config.get(PUBLIC_GATEWAY_ADDRESS);
  }
}
