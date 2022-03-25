import {
  PrivateGateway as BasePrivateGateway,
  PrivateNodeRegistration,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { makeGSCClient } from './sync/publicGateway/gscClient';
import { PublicGatewayProtocolError } from './sync/publicGateway/errors';
import { Config, ConfigKey } from './Config';

export class PrivateGateway extends BasePrivateGateway {
  public async registerWithPublicGateway(publicGatewayAddress: string): Promise<void> {
    const client = await makeGSCClient(publicGatewayAddress);

    const registrationAuth = await client.preRegisterNode(await this.getIdentityPublicKey());
    const registrationRequest = await this.requestPublicGatewayRegistration(registrationAuth);

    let registration: PrivateNodeRegistration;
    try {
      registration = await client.registerNode(registrationRequest);
    } catch (err) {
      throw new PublicGatewayProtocolError(
        err as Error,
        'Failed to register with the public gateway',
      );
    }

    await this.saveRegistration(registration);
  }

  private async saveRegistration(registration: PrivateNodeRegistration): Promise<void> {
    const sessionKey = registration.sessionKey;
    if (!sessionKey) {
      throw new PublicGatewayProtocolError('Registration is missing public gateway session key');
    }

    try {
      await this.savePublicGatewayChannel(
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

    const config = Container.get(Config);
    await config.set(
      ConfigKey.PUBLIC_GATEWAY_PRIVATE_ADDRESS,
      await registration.gatewayCertificate.calculateSubjectPrivateAddress(),
    );
  }
}
