import { PrivateKey } from '@relaycorp/keystore-db';
import {
  Certificate,
  derSerializePrivateKey,
  derSerializePublicKey,
} from '@relaycorp/relaynet-core';
import { addMonths, subMinutes, subMonths, subSeconds } from 'date-fns';
import { Container } from 'typedi';
import { getConnection, Repository } from 'typeorm';

import { Config, ConfigKey } from '../Config';
import { UnregisteredGatewayError } from '../errors';
import { generatePKIFixture } from '../testUtils/crypto';
import { setUpTestDBConnection } from '../testUtils/db';
import { getPromiseRejection } from '../testUtils/promises';
import { DBPrivateKeyStore } from './DBPrivateKeyStore';

setUpTestDBConnection();

let keystore: DBPrivateKeyStore;
let privateKeyRepository: Repository<PrivateKey>;
let config: Config;
beforeEach(() => {
  const connection = getConnection();
  privateKeyRepository = connection.getRepository(PrivateKey);
  config = Container.get(Config);
  keystore = new DBPrivateKeyStore(privateKeyRepository, config);
});

let privateGatewayKeyPair: CryptoKeyPair;
let privateGatewayCertificate: Certificate;
generatePKIFixture(async (keyPairSet, pdaCertPath) => {
  privateGatewayKeyPair = keyPairSet.privateGateway;
  privateGatewayCertificate = pdaCertPath.privateGateway;
});

describe('getCurrentKey', () => {
  test('Null should be returned if no current key has been set', async () => {
    await expect(keystore.getCurrentKey()).resolves.toBeNull();
  });

  test('Current key should be returned if found', async () => {
    await saveCurrentPDAKey();

    const key = await keystore.getCurrentKey();

    expect(key).toBeTruthy();
    expect(key!.certificate.isEqual(privateGatewayCertificate));
    await expect(derSerializePrivateKey(key!.privateKey)).resolves.toEqual(
      await derSerializePrivateKey(privateGatewayKeyPair.privateKey),
    );
  });
});

describe('getOrCreateCCAIssuer', () => {
  describe('Issuer generation', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    test('Error should be thrown if there is no current key', async () => {
      const error = await getPromiseRejection(
        keystore.getOrCreateCCAIssuer(),
        UnregisteredGatewayError,
      );

      expect(error.message).toEqual('Cannot find a PDA key; private gateway may be unregistered');
    });

    test('Certificate should be generated if there is none', async () => {
      await saveCurrentPDAKey();

      const certificate = await keystore.getOrCreateCCAIssuer();

      await expect(derSerializePublicKey(await certificate.getPublicKey())).resolves.toEqual(
        await derSerializePublicKey(privateGatewayKeyPair.publicKey),
      );
    });

    test('Certificate should be valid for 12 months', async () => {
      await saveCurrentPDAKey();

      const certificate = await keystore.getOrCreateCCAIssuer();

      const expectedExpiryDate = addMonths(new Date(), 12);
      expect(certificate.expiryDate).toBeBefore(expectedExpiryDate);
      expect(certificate.expiryDate).toBeAfter(subSeconds(expectedExpiryDate, 5));
    });

    test('Certificate should be regenerated if existing one will expire in <= 6 months', async () => {
      jest.useFakeTimers();
      await saveCurrentPDAKey();
      const originalCertificate = await keystore.getOrCreateCCAIssuer();
      const cutoffDateMs =
        subMonths(originalCertificate.expiryDate, 6).getTime() - new Date().getTime();
      jest.advanceTimersByTime(cutoffDateMs + 1_000);

      const certificate = await keystore.getOrCreateCCAIssuer();

      expect(originalCertificate.isEqual(certificate)).toBeFalse();
    });

    test('Certificate should be valid from 90 minutes in the past', async () => {
      await saveCurrentPDAKey();

      const certificate = await keystore.getOrCreateCCAIssuer();

      const expectedStartDate = subMinutes(new Date(), 90);
      expect(certificate.startDate).toBeAfter(subSeconds(expectedStartDate, 5));
      expect(certificate.startDate).toBeBefore(expectedStartDate);
    });
  });

  test('Existing certificate should be reused if it will be valid for 6+ months', async () => {
    await saveCurrentPDAKey();
    const originalCertificate = await keystore.getOrCreateCCAIssuer();

    const certificate = await keystore.getOrCreateCCAIssuer();

    expect(originalCertificate.isEqual(certificate)).toBeTrue();
  });
});

async function saveCurrentPDAKey(): Promise<void> {
  await keystore.saveNodeKey(privateGatewayKeyPair.privateKey, privateGatewayCertificate);
  await config.set(
    ConfigKey.NODE_KEY_SERIAL_NUMBER,
    privateGatewayCertificate.getSerialNumberHex(),
  );
}
