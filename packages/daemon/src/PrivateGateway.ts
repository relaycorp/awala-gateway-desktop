import {
  PrivateGateway as BasePrivateGateway,
  PrivateNodeRegistration,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { makeGSCClient } from './sync/publicGateway/gscClient';
import { InternetGatewayProtocolError } from './sync/publicGateway/errors';
import { Config, ConfigKey } from './Config';

export class PrivateGateway extends BasePrivateGateway {
  /**
   * Register with public gateway and return the expiry date of the private gateway's certificate.
   *
   * @param publicGatewayAddress
   */
  public async registerWithPublicGateway(publicGatewayAddress: string): Promise<Date> {
    const client = await makeGSCClient(publicGatewayAddress);

    const registrationAuth = await client.preRegisterNode(await this.getIdentityPublicKey());
    const registrationRequest = await this.requestInternetGatewayRegistration(registrationAuth);

    let registration: PrivateNodeRegistration;
    try {
      registration = await client.registerNode(registrationRequest);
    } catch (err) {
      throw new InternetGatewayProtocolError(
        err as Error,
        'Failed to register with the public gateway',
      );
    }

    await this.saveRegistration(registration);

    return registration.privateNodeCertificate.expiryDate;
  }

  private async saveRegistration(registration: PrivateNodeRegistration): Promise<void> {
    const sessionKey = registration.sessionKey;
    if (!sessionKey) {
      throw new InternetGatewayProtocolError('Registration is missing public gateway session key');
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
        'Failed to save channel with public gateway',
      );
    }

    const config = Container.get(Config);
    await config.set(
      ConfigKey.INTERNET_GATEWAY_ID,
      await registration.gatewayCertificate.calculateSubjectId(),
    );
  }
}
