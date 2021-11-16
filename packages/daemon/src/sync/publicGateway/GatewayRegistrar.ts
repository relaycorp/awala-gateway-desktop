import {
  Certificate,
  generateRSAKeyPair,
  PrivateKeyStore,
  PrivateNodeRegistration,
  PrivateNodeRegistrationRequest,
  PublicKeyStore,
  UnreachableResolverError,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { Container, Inject, Service } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { FileStore } from '../../fileStore';
import { DBPrivateKeyStore } from '../../keystores/DBPrivateKeyStore';
import { DBPublicKeyStore } from '../../keystores/DBPublicKeyStore';
import { LOGGER } from '../../tokens';
import { sleepSeconds } from '../../utils/timing';
import { makeGSCClient } from './gscClient';
import { PublicGateway } from './PublicGateway';
import { PublicGatewayProtocolError } from './errors';

export const PUBLIC_GATEWAY_ID_CERTIFICATE_OBJECT_KEY = 'public-gateway-id-certificate.der';

@Service()
export class GatewayRegistrar {
  constructor(
    @Inject(() => DBPrivateKeyStore) private privateKeyStore: PrivateKeyStore,
    @Inject(() => DBPublicKeyStore) private publicKeyStore: PublicKeyStore,
    private config: Config,
    @Inject() private fileStore: FileStore,
  ) {}

  /**
   * Register with the `publicGatewayAddress`.
   *
   * @param publicGatewayAddress
   * @throws UnreachableResolverError if DNS resolver is unreachable
   * @throws PublicAddressingError if the DNS lookup or DNSSEC verification failed
   * @throws NonExistingAddressError if the DNS+DNSSEC lookup succeeded but the address doesn't exist
   * @throws PublicGatewayProtocolError if the public gateways violates the protocol
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

    let registration: PrivateNodeRegistration;
    try {
      registration = await client.registerNode(
        await registrationRequest.serialize(identityKeyPair.privateKey),
      );
    } catch (err) {
      throw new PublicGatewayProtocolError(err, 'Failed to register with the public gateway');
    }

    await this.saveRegistration(registration, identityKeyPair, publicGatewayAddress);
  }

  public async waitForRegistration(): Promise<void> {
    const logger = Container.get(LOGGER);
    while (!(await this.isRegistered())) {
      try {
        await this.register(DEFAULT_PUBLIC_GATEWAY);
      } catch (err) {
        if (err instanceof UnreachableResolverError) {
          // The device may be disconnected from the Internet or the DNS resolver may be blocked.
          logger.debug(
            'Failed to register with public gateway because DNS resolver is unreachable',
          );
          await sleepSeconds(5);
        } else {
          logger.error({ err }, 'Failed to register with public gateway');
          await sleepSeconds(60);
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
    const sessionKey = registration.sessionKey;
    if (!sessionKey) {
      throw new PublicGatewayProtocolError('Registration is missing public gateway session key');
    }

    const identityCertificate = registration.privateNodeCertificate;
    await this.privateKeyStore.saveNodeKey(identityKeyPair.privateKey, identityCertificate);
    await this.config.set(
      ConfigKey.NODE_KEY_SERIAL_NUMBER,
      identityCertificate.getSerialNumberHex(),
    );

    await this.publicKeyStore.saveSessionKey(
      sessionKey,
      await registration.gatewayCertificate.calculateSubjectPrivateAddress(),
      new Date(),
    );

    await this.config.set(ConfigKey.PUBLIC_GATEWAY_ADDRESS, publicGatewayAddress);
    await this.fileStore.putObject(
      Buffer.from(registration.gatewayCertificate.serialize()),
      PUBLIC_GATEWAY_ID_CERTIFICATE_OBJECT_KEY,
    );
  }
}
