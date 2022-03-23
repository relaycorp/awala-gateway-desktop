// tslint:disable:max-classes-per-file

import {
  getPublicKeyDigest,
  PrivateNodeRegistrationRequest,
  PrivatePublicGatewayChannel,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { Inject, Service } from 'typedi';

import { PrivateGatewayError } from '../errors';
import { PrivateGatewayManager } from '../PrivateGatewayManager';
import { addSeconds } from 'date-fns';

@Service()
export class EndpointRegistrar {
  constructor(@Inject() protected gatewayManager: PrivateGatewayManager) {}

  /**
   * Pre-register endpoint and return a registration authorization serialized.
   *
   * @param endpointPublicKeyDigest
   * @throws {MalformedEndpointKeyDigestError} if `endpointPublicKeyDigest` is malformed
   * @throws {UnregisteredGatewayError}
   */
  public async preRegister(endpointPublicKeyDigest: string): Promise<Buffer> {
    if (endpointPublicKeyDigest.length !== 64) {
      throw new MalformedEndpointKeyDigestError(
        `Expected digest to have 64 chars (got ${endpointPublicKeyDigest.length})`,
      );
    }

    const gatewayData = bufferToArray(Buffer.from(endpointPublicKeyDigest, 'hex'));
    const expiryDate = addSeconds(new Date(), 10);
    const channel = await this.gatewayManager.getCurrentChannel();
    const authorizationSerialized = await channel.authorizeEndpointRegistration(
      gatewayData,
      expiryDate,
    );
    return Buffer.from(authorizationSerialized);
  }

  /**
   * Process the registration request and return the registration data if successful.
   *
   * @param registrationRequestSerialized
   * @throws {InvalidRegistrationRequestError} if `registrationRequestSerialized` is malformed/invalid
   * @throws {UnregisteredGatewayError}
   */
  public async completeRegistration(registrationRequestSerialized: Buffer): Promise<Buffer> {
    const channel = await this.gatewayManager.getCurrentChannel();

    const endpointPublicKey = await validateRegistrationRequest(
      registrationRequestSerialized,
      channel,
    );
    const registrationSerialized = await channel.registerEndpoint(endpointPublicKey);
    return Buffer.from(registrationSerialized);
  }
}

async function validateRegistrationRequest(
  registrationRequestSerialized: Buffer,
  channel: PrivatePublicGatewayChannel,
): Promise<CryptoKey> {
  let request: PrivateNodeRegistrationRequest;
  try {
    request = await PrivateNodeRegistrationRequest.deserialize(
      bufferToArray(registrationRequestSerialized),
    );
  } catch (err) {
    throw new InvalidRegistrationRequestError(
      err as Error,
      'Registration request is invalid/malformed',
    );
  }

  let gatewayData: ArrayBuffer;
  try {
    gatewayData = await channel.verifyEndpointRegistrationAuthorization(request.pnraSerialized);
  } catch (err) {
    throw new InvalidRegistrationRequestError(
      err as Error,
      'Authorization in registration request is invalid/malformed',
    );
  }

  const endpointPublicKey = request.privateNodePublicKey;
  const endpointPublicKeyDigest = Buffer.from(await getPublicKeyDigest(endpointPublicKey));
  if (!endpointPublicKeyDigest.equals(Buffer.from(gatewayData))) {
    throw new InvalidRegistrationRequestError(
      'Subject key in request does not match that of authorization',
    );
  }
  return endpointPublicKey;
}

export class MalformedEndpointKeyDigestError extends PrivateGatewayError {}

export class InvalidRegistrationRequestError extends PrivateGatewayError {}
