// tslint:disable:max-classes-per-file

import { PrivateNodeRegistrationAuthorization } from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { Inject, Service } from 'typedi';

import { PrivateGatewayError, UnregisteredGatewayError } from '../errors';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';

@Service()
export class EndpointRegistrar {
  constructor(@Inject() protected privateKeyStore: DBPrivateKeyStore) {}

  /**
   * Pre-register endpoint and return a registration authorization serialized.
   *
   * @param endpointPublicKeyDigest
   * @throws MalformedEndpointKeyDigestError if `endpointPublicKeyDigest` is malformed
   */
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

  /**
   * Process the registration request and return the registration data if successful.
   *
   * @param _registrationRequestSerialized
   * @throws InvalidRegistrationRequestError if `_registrationRequestSerialized` is malformed/invalid
   */
  public async completeRegistration(_registrationRequestSerialized: Buffer): Promise<Buffer> {
    throw new Error('implement');
  }
}

export class MalformedEndpointKeyDigestError extends PrivateGatewayError {}

export class InvalidRegistrationRequestError extends PrivateGatewayError {}
