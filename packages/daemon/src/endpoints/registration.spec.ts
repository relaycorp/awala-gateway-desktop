import { Certificate, PrivateNodeRegistrationAuthorization } from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { Container } from 'typedi';

import { UnregisteredGatewayError } from '../errors';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { setUpTestDBConnection } from '../testUtils/db';
import { EndpointRegistrar, MalformedEndpointKeyDigestError } from './registration';

setUpTestDBConnection();

let nodeKeyPair: CryptoKeyPair;
let nodeCertificate: Certificate;
beforeAll(async () => {
  const pairSet = await generateNodeKeyPairSet();
  const certPath = await generatePDACertificationPath(pairSet);

  nodeKeyPair = pairSet.privateGateway;
  nodeCertificate = certPath.privateGateway;
});

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

      await expect(registrar.preRegister('a'.repeat(64))).rejects.toBeInstanceOf(
        UnregisteredGatewayError,
      );
    });

    test('Keys with well-formed digests should be pre-authorized', async () => {
      const privateKeyStore = Container.get(DBPrivateKeyStore);
      await privateKeyStore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);
      const privateEndpointPublicKeyDigest = Buffer.from('a'.repeat(64), 'hex');
      const registrar = Container.get(EndpointRegistrar);

      const authorizationSerialized = await registrar.preRegister(
        privateEndpointPublicKeyDigest.toString('hex'),
      );

      const authorization = await PrivateNodeRegistrationAuthorization.deserialize(
        bufferToArray(authorizationSerialized),
        nodeKeyPair.publicKey,
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
    // TODO: REPLACE WITH ACTUAL TESTS
    test('TODO', async () => {
      const registrar = Container.get(EndpointRegistrar);

      await expect(registrar.completeRegistration(null as any)).toReject();
    });
  });
});
