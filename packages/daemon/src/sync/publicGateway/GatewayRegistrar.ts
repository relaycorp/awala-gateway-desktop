import {
  Certificate,
  generateRSAKeyPair,
  PrivateKeyStore,
  PrivateNodeRegistration,
  PrivateNodeRegistrationRequest,
  PublicAddressingError,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { Inject, Service } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { FileStore } from '../../fileStore';
import { DBPrivateKeyStore } from '../../keystores/DBPrivateKeyStore';
import { sleepSeconds } from '../../utils/timing';
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

    await this.saveRegistration(registration, identityKeyPair, publicGatewayAddress);
  }

  public async registerIfUnregistered(): Promise<void> {
    while (!(await this.isRegistered())) {
      try {
        await this.register(DEFAULT_PUBLIC_GATEWAY);
      } catch (err) {
        if (err instanceof PublicAddressingError) {
          // The device is disconnected from the Internet. Retry later.
          await sleepSeconds(5);
        } else {
          break;
        }
      }
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
    return this.config.get(ConfigKey.PUBLIC_GATEWAY_ADDRESS);
  }

  private async saveRegistration(
    registration: PrivateNodeRegistration,
    identityKeyPair: CryptoKeyPair,
    publicGatewayAddress: string,
  ): Promise<void> {
    const identityCertificate = registration.privateNodeCertificate;
    await this.privateKeyStore.saveNodeKey(identityKeyPair.privateKey, identityCertificate);
    await this.config.set(
      ConfigKey.NODE_KEY_SERIAL_NUMBER,
      identityCertificate.getSerialNumberHex(),
    );

    await this.config.set(ConfigKey.PUBLIC_GATEWAY_ADDRESS, publicGatewayAddress);
    await this.fileStore.putObject(
      Buffer.from(registration.gatewayCertificate.serialize()),
      PUBLIC_GATEWAY_ID_CERTIFICATE_OBJECT_KEY,
    );
  }
}
