import {
  Certificate,
  derSerializePublicKey,
  getPublicKeyDigestHex,
  InvalidMessageError,
  PrivateNodeRegistration,
  PrivateNodeRegistrationAuthorization,
  PrivateNodeRegistrationRequest,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { Container } from 'typedi';

import { UnregisteredGatewayError } from '../errors';
import { useTemporaryAppDirs } from '../testUtils/appDirs';
import { arrayBufferFrom } from '../testUtils/buffer';
import { generatePKIFixture, mockGatewayRegistration } from '../testUtils/crypto';
import { setUpTestDBConnection } from '../testUtils/db';
import { getPromiseRejection } from '../testUtils/promises';
import {
  EndpointRegistrar,
  InvalidRegistrationRequestError,
  MalformedEndpointKeyDigestError,
} from './registration';

setUpTestDBConnection();
useTemporaryAppDirs();

let gatewayKeyPair: CryptoKeyPair;
let gatewayCertificate: Certificate;
let endpointKeyPair: CryptoKeyPair;
const pkiFixtureRetriever = generatePKIFixture(async (pairSet, certPath) => {
  gatewayKeyPair = pairSet.privateGateway;
  gatewayCertificate = certPath.privateGateway;

  endpointKeyPair = pairSet.privateEndpoint;
});
const { undoGatewayRegistration } = mockGatewayRegistration(pkiFixtureRetriever);

describe('EndpointRegistration', () => {
  describe('preRegister', () => {
    test('Digests with more than 64 chars should be rejected', async () => {
      const registrar = Container.get(EndpointRegistrar);

      await expect(registrar.preRegister('a'.repeat(63))).rejects.toBeInstanceOf(
        MalformedEndpointKeyDigestError,
      );
    });

    test('Digests with fewer than 64 chars should be rejected', async () => {
      const registrar = Container.get(EndpointRegistrar);

      await expect(registrar.preRegister('a'.repeat(65))).rejects.toBeInstanceOf(
        MalformedEndpointKeyDigestError,
      );
    });

    test('Pre-registration should be refused if gateway has not yet registered', async () => {
      const registrar = Container.get(EndpointRegistrar);
      await undoGatewayRegistration();

      await expect(registrar.preRegister('a'.repeat(64))).rejects.toBeInstanceOf(
        UnregisteredGatewayError,
      );
    });

    test('Keys with well-formed digests should be pre-authorized', async () => {
      const privateEndpointPublicKeyDigest = Buffer.from('a'.repeat(64), 'hex');
      const registrar = Container.get(EndpointRegistrar);

      const authorizationSerialized = await registrar.preRegister(
        privateEndpointPublicKeyDigest.toString('hex'),
      );

      const authorization = await PrivateNodeRegistrationAuthorization.deserialize(
        bufferToArray(authorizationSerialized),
        gatewayKeyPair.publicKey!,
      );
      const now = new Date();
      expect(authorization.expiryDate.getTime()).toBeGreaterThan(now.getTime() + 8_000);
      expect(authorization.expiryDate.getTime()).toBeLessThanOrEqual(now.getTime() + 10_000);
      expect(
        privateEndpointPublicKeyDigest.equals(Buffer.from(authorization.gatewayData)),
      ).toBeTruthy();
    });
  });

  describe('completeRegistration', () => {
    test('InvalidRegistrationRequestError should be thrown if the PNRR is invalid', async () => {
      const registrar = Container.get(EndpointRegistrar);

      const error = await getPromiseRejection(
        registrar.completeRegistration(Buffer.from([])),
        InvalidRegistrationRequestError,
      );

      expect(error.message).toMatch(/^Registration request is invalid\/malformed:/);
      expect(error.cause()).toBeInstanceOf(InvalidMessageError);
    });

    test('InvalidRegistrationRequestError should be thrown if the auth is invalid', async () => {
      const registrar = Container.get(EndpointRegistrar);
      const request = new PrivateNodeRegistrationRequest(
        endpointKeyPair.publicKey!,
        arrayBufferFrom('invalid'),
      );
      const requestSerialized = await request.serialize(endpointKeyPair.privateKey!);

      const error = await getPromiseRejection(
        registrar.completeRegistration(Buffer.from(requestSerialized)),
        InvalidRegistrationRequestError,
      );

      expect(error.message).toMatch(
        /^Authorization in registration request is invalid\/malformed:/,
      );
      expect(error.cause()).toBeInstanceOf(InvalidMessageError);
    });

    test('InvalidRegistrationRequestError should be thrown if the auth does not match key', async () => {
      const registrar = Container.get(EndpointRegistrar);
      const authorizationSerialized = await registrar.preRegister(
        await getPublicKeyDigestHex(gatewayKeyPair.publicKey!), // Wrong key
      );
      const request = new PrivateNodeRegistrationRequest(
        endpointKeyPair.publicKey!,
        bufferToArray(authorizationSerialized),
      );
      const requestSerialized = await request.serialize(endpointKeyPair.privateKey!);

      const error = await getPromiseRejection(
        registrar.completeRegistration(Buffer.from(requestSerialized)),
        InvalidRegistrationRequestError,
      );

      expect(error.message).toEqual('Subject key in request does not match that of authorization');
      expect(error.cause()).toBeUndefined();
    });

    test('Registration should fail if gateway is unregistered', async () => {
      const registrar = Container.get(EndpointRegistrar);
      const requestSerialized = await makeRegistrationRequest(registrar);
      await undoGatewayRegistration();

      await expect(registrar.completeRegistration(requestSerialized)).rejects.toBeInstanceOf(
        UnregisteredGatewayError,
      );
    });

    test('Registration data should be returned on success', async () => {
      const registrar = Container.get(EndpointRegistrar);
      const requestSerialized = await makeRegistrationRequest(registrar);

      const registrationSerialized = await registrar.completeRegistration(
        Buffer.from(requestSerialized),
      );

      await PrivateNodeRegistration.deserialize(bufferToArray(registrationSerialized));
    });

    test('Endpoint certificate should be issued by public gateway', async () => {
      const registrar = Container.get(EndpointRegistrar);
      const requestSerialized = await makeRegistrationRequest(registrar);

      const registrationSerialized = await registrar.completeRegistration(
        Buffer.from(requestSerialized),
      );

      const registration = await PrivateNodeRegistration.deserialize(
        bufferToArray(registrationSerialized),
      );
      const endpointCertificate = registration.privateNodeCertificate;
      await expect(endpointCertificate.getCertificationPath([], [gatewayCertificate]));
    });

    test('Endpoint certificate should honor subject public key', async () => {
      const registrar = Container.get(EndpointRegistrar);
      const requestSerialized = await makeRegistrationRequest(registrar);

      const registrationSerialized = await registrar.completeRegistration(
        Buffer.from(requestSerialized),
      );

      const registration = await PrivateNodeRegistration.deserialize(
        bufferToArray(registrationSerialized),
      );
      const endpointCertificate = registration.privateNodeCertificate;
      await expect(
        derSerializePublicKey(await endpointCertificate.getPublicKey()),
      ).resolves.toEqual(await derSerializePublicKey(endpointKeyPair.publicKey!));
    });

    test('Gateway certificate should be included in registration', async () => {
      const registrar = Container.get(EndpointRegistrar);
      const requestSerialized = await makeRegistrationRequest(registrar);

      const registrationSerialized = await registrar.completeRegistration(
        Buffer.from(requestSerialized),
      );

      const registration = await PrivateNodeRegistration.deserialize(
        bufferToArray(registrationSerialized),
      );
      expect(registration.gatewayCertificate.isEqual(gatewayCertificate)).toBeTrue();
    });

    async function makeRegistrationRequest(registrar: EndpointRegistrar): Promise<Buffer> {
      const authorizationSerialized = await registrar.preRegister(
        await getPublicKeyDigestHex(endpointKeyPair.publicKey!),
      );
      const request = new PrivateNodeRegistrationRequest(
        endpointKeyPair.publicKey!,
        bufferToArray(authorizationSerialized),
      );
      const requestSerialized = await request.serialize(endpointKeyPair.privateKey!);
      return Buffer.from(requestSerialized);
    }
  });
});
