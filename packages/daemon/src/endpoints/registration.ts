// tslint:disable:max-classes-per-file

import {
  getPublicKeyDigest,
  issueEndpointCertificate,
  PrivateNodeRegistration,
  PrivateNodeRegistrationAuthorization,
  PrivateNodeRegistrationRequest,
  UnboundKeyPair,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { addMonths } from 'date-fns';
import { Inject, Service } from 'typedi';

import { PrivateGatewayError, UnregisteredGatewayError } from '../errors';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';

const ENDPOINT_CERT_VALIDITY_MONTHS = 12;

@Service()
export class EndpointRegistrar {
  constructor(@Inject() protected privateKeyStore: DBPrivateKeyStore) {}

  /**
   * Pre-register endpoint and return a registration authorization serialized.
   *
   * @param endpointPublicKeyDigest
   * @throws MalformedEndpointKeyDigestError if `endpointPublicKeyDigest` is malformed
   * @throws UnregisteredGatewayError if gateway is not yet registered with its public peer
   */
  public async preRegister(endpointPublicKeyDigest: string): Promise<Buffer> {
    if (endpointPublicKeyDigest.length !== 64) {
      throw new MalformedEndpointKeyDigestError(
        `Expected digest to have 64 chars (got ${endpointPublicKeyDigest.length})`,
      );
    }

    const currentKey = await this.getCurrentKey();

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
   * @param registrationRequestSerialized
   * @throws InvalidRegistrationRequestError if `registrationRequestSerialized` is malformed/invalid
   */
  public async completeRegistration(registrationRequestSerialized: Buffer): Promise<Buffer> {
    let request: PrivateNodeRegistrationRequest;
    try {
      request = await PrivateNodeRegistrationRequest.deserialize(
        bufferToArray(registrationRequestSerialized),
      );
    } catch (err) {
      throw new InvalidRegistrationRequestError(err, 'Registration request is invalid/malformed');
    }

    const currentKey = await this.getCurrentKey();
    const currentPublicKey = await currentKey.certificate.getPublicKey();
    let authorization: PrivateNodeRegistrationAuthorization;
    try {
      authorization = await PrivateNodeRegistrationAuthorization.deserialize(
        request.pnraSerialized,
        currentPublicKey,
      );
    } catch (err) {
      throw new InvalidRegistrationRequestError(
        err,
        'Authorization in registration request is invalid/malformed',
      );
    }

    const endpointPublicKeyDigest = Buffer.from(
      await getPublicKeyDigest(request.privateNodePublicKey),
    );
    if (!endpointPublicKeyDigest.equals(Buffer.from(authorization.gatewayData))) {
      throw new InvalidRegistrationRequestError(
        'Subject key in request does not match that of authorization',
      );
    }

    const now = new Date();
    const endpointCertificate = await issueEndpointCertificate({
      issuerCertificate: currentKey.certificate,
      issuerPrivateKey: currentKey.privateKey,
      subjectPublicKey: request.privateNodePublicKey,
      validityEndDate: addMonths(now, ENDPOINT_CERT_VALIDITY_MONTHS),
      validityStartDate: now,
    });
    const registration = new PrivateNodeRegistration(endpointCertificate, currentKey.certificate);
    return Buffer.from(registration.serialize());
  }

  private async getCurrentKey(): Promise<UnboundKeyPair> {
    const currentKey = await this.privateKeyStore.getCurrentKey();
    if (!currentKey) {
      throw new UnregisteredGatewayError();
    }
    return currentKey;
  }
}

export class MalformedEndpointKeyDigestError extends PrivateGatewayError {}

export class InvalidRegistrationRequestError extends PrivateGatewayError {}
