import {
  PrivateGateway,
  PrivateNodeRegistration,
  UnreachableResolverError,
} from '@relaycorp/relaynet-core';
import { Container, Inject, Service } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { LOGGER } from '../../tokens';
import { sleepSeconds } from '../../utils/timing';
import { makeGSCClient } from './gscClient';
import { PublicGatewayProtocolError } from './errors';
import { PrivateGatewayManager } from '../../PrivateGatewayManager';

@Service()
export class GatewayRegistrar {
  constructor(private config: Config, @Inject() private gatewayManager: PrivateGatewayManager) {}

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
    const logger = Container.get(LOGGER);

    const currentPublicGatewayAddress = await this.getPublicGatewayAddress();
    if (currentPublicGatewayAddress === publicGatewayAddress) {
      logger.debug('Skipping registration with public gateway');
      return;
    }

    const client = await makeGSCClient(publicGatewayAddress);

    const privateGateway = await this.gatewayManager.getCurrent();

    const registrationAuth = await client.preRegisterNode(
      await privateGateway.getIdentityPublicKey(),
    );
    const registrationRequest = await privateGateway.requestPublicGatewayRegistration(
      registrationAuth,
    );

    let registration: PrivateNodeRegistration;
    try {
      registration = await client.registerNode(registrationRequest);
    } catch (err) {
      throw new PublicGatewayProtocolError(
        err as Error,
        'Failed to register with the public gateway',
      );
    }

    await this.saveRegistration(registration, publicGatewayAddress, privateGateway);
    logger.info(
      {
        publicGatewayPublicAddress: publicGatewayAddress,
        publicGatewayPrivateAddress:
          await registration.gatewayCertificate.calculateSubjectPrivateAddress(),
      },
      'Successfully registered with public gateway',
    );
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

  private getPublicGatewayAddress(): Promise<string | null> {
    return this.config.get(ConfigKey.PUBLIC_GATEWAY_ADDRESS);
  }

  private async saveRegistration(
    registration: PrivateNodeRegistration,
    publicGatewayAddress: string,
    privateGateway: PrivateGateway,
  ): Promise<void> {
    const sessionKey = registration.sessionKey;
    if (!sessionKey) {
      throw new PublicGatewayProtocolError('Registration is missing public gateway session key');
    }

    try {
      await privateGateway.savePublicGatewayChannel(
        registration.privateNodeCertificate,
        registration.gatewayCertificate,
        sessionKey,
      );
    } catch (err) {
      throw new PublicGatewayProtocolError(
        err as Error,
        'Failed to save channel with public gateway',
      );
    }
    await this.config.set(
      ConfigKey.PUBLIC_GATEWAY_PRIVATE_ADDRESS,
      await registration.gatewayCertificate.calculateSubjectPrivateAddress(),
    );
    await this.config.set(ConfigKey.PUBLIC_GATEWAY_ADDRESS, publicGatewayAddress);
  }
}
