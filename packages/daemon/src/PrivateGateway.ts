import {
  PrivateGateway as BasePrivateGateway,
  PrivateNodeRegistration,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { makeGSCClient } from './sync/internetGateway/gscClient';
import { InternetGatewayProtocolError } from './sync/internetGateway/errors';
import { Config, ConfigKey } from './Config';

export class PrivateGateway extends BasePrivateGateway {
  /**
   * Register with Internet gateway and return the expiry date of the private gateway's certificate.
   *
   * @param internetGatewayAddress
   */
  public async registerWithInternetGateway(internetGatewayAddress: string): Promise<Date> {
    const client = await makeGSCClient(internetGatewayAddress);

    const registrationAuth = await client.preRegisterNode(await this.getIdentityPublicKey());
    const registrationRequest = await this.requestInternetGatewayRegistration(registrationAuth);

    let registration: PrivateNodeRegistration;
    try {
      registration = await client.registerNode(registrationRequest);
    } catch (err) {
      throw new InternetGatewayProtocolError(
        err as Error,
        'Failed to register with the Internet gateway',
      );
    }

    await this.saveRegistration(registration);

    return registration.privateNodeCertificate.expiryDate;
  }

  private async saveRegistration(registration: PrivateNodeRegistration): Promise<void> {
    const sessionKey = registration.sessionKey;
    if (!sessionKey) {
      throw new InternetGatewayProtocolError(
        'Registration is missing Internet gateway session key',
      );
    }

    try {
      await this.saveInternetGatewayChannel(
        registration.privateNodeCertificate,
        registration.gatewayCertificate,
        sessionKey,
      );
    } catch (err) {
      throw new InternetGatewayProtocolError(
        err as Error,
        'Failed to save channel with Internet gateway',
      );
    }

    const config = Container.get(Config);
    await config.set(
      ConfigKey.INTERNET_GATEWAY_ID,
      await registration.gatewayCertificate.calculateSubjectId(),
    );
  }
}
