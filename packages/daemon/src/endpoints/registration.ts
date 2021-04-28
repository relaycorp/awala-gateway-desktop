// tslint:disable:max-classes-per-file

import { PrivateNodeRegistrationAuthorization } from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { Inject, Service } from 'typedi';

import { PrivateGatewayError, UnregisteredGatewayError } from '../errors';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';

@Service()
export class EndpointRegistrar {
  constructor(@Inject() protected privateKeyStore: DBPrivateKeyStore) {}

  public async preRegister(endpointPublicKeyDigest: string): Promise<Buffer> {
    if (endpointPublicKeyDigest.length !== 64) {
      throw new MalformedEndpointKeyDigestError(
        `Expected digest to have 64 chars (got ${endpointPublicKeyDigest.length})`,
      );
    }

    const currentKey = await this.privateKeyStore.getCurrentKey();
    if (!currentKey) {
      throw new UnregisteredGatewayError();
    }

    const gatewayData = bufferToArray(Buffer.from(endpointPublicKeyDigest, 'hex'));
    const tenSecondsInTheFuture = new Date();
    tenSecondsInTheFuture.setSeconds(tenSecondsInTheFuture.getSeconds() + 10);
    const authorization = new PrivateNodeRegistrationAuthorization(
      tenSecondsInTheFuture,
      gatewayData,
    );
    const authorizationSerialized = await authorization.serialize(currentKey.privateKey);
    return Buffer.from(authorizationSerialized);
  }
}

export class MalformedEndpointKeyDigestError extends PrivateGatewayError {}
