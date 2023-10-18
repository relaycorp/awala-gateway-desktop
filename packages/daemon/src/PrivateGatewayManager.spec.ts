import {
  Certificate,
  CertificationPath,
  getRSAPublicKeyFromPrivate,
  issueGatewayCertificate,
  ParcelDeliveryVerifier,
} from '@relaycorp/relaynet-core';
import { IdentityPublicKey } from '@relaycorp/keystore-db';
import { addDays } from 'date-fns';
import { getRepository } from 'typeorm';
import { Container } from 'typedi';

import { PrivateGatewayManager } from './PrivateGatewayManager';
import { setUpTestDBConnection } from './testUtils/db';
import { Config, ConfigKey } from './Config';
import { MissingGatewayError, UnregisteredGatewayError } from './errors';
import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import { DBCertificateStore } from './keystores/DBCertificateStore';
import { generatePKIFixture, mockGatewayRegistration } from './testUtils/crypto';
import { DEFAULT_INTERNET_GATEWAY_ADDRESS } from './constants';
import { useTemporaryAppDirs } from './testUtils/appDirs';
import { PrivateGateway } from './PrivateGateway';

setUpTestDBConnection();
useTemporaryAppDirs();

let gatewayManager: PrivateGatewayManager;
beforeEach(() => {
  gatewayManager = Container.get(PrivateGatewayManager);
});

describe('createCurrentIfMissing', () => {
  test('Node should be created if id is absent', async () => {
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.CURRENT_ID)).resolves.toBeNull();

    await gatewayManager.createCurrentIfMissing();

    const id = await config.get(ConfigKey.CURRENT_ID);
    expect(id).toBeTruthy();
    await expect(gatewayManager.get(id!)).resolves.not.toBeNull();
  });

  test('Node should be created if private key does not', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.CURRENT_ID, '0deadbeef');

    await gatewayManager.createCurrentIfMissing();

    const id = await config.get(ConfigKey.CURRENT_ID);
    await expect(gatewayManager.get(id!)).resolves.not.toBeNull();
  });

  test('Node should be reused if it already exists', async () => {
    await gatewayManager.createCurrentIfMissing();
    const config = Container.get(Config);
    const originalId = await config.get(ConfigKey.CURRENT_ID);

    await gatewayManager.createCurrentIfMissing();

    const newId = await config.get(ConfigKey.CURRENT_ID);
    expect(newId).toBeTruthy();
    expect(newId).toEqual(originalId);
  });
});

describe('getCurrent', () => {
  test('Error should be thrown if id is absent', async () => {
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.CURRENT_ID)).resolves.toBeNull();

    await expect(gatewayManager.getCurrent()).rejects.toThrowWithMessage(
      MissingGatewayError,
      'Config does not contain current id',
    );
  });

  test('Error should be thrown if private key is absent', async () => {
    const id = '0deadbeef';
    await Container.get(Config).set(ConfigKey.CURRENT_ID, id);

    await expect(gatewayManager.getCurrent()).rejects.toThrowWithMessage(
      MissingGatewayError,
      `Private key (${id}) is missing`,
    );
  });

  test('Existing gateway should be returned', async () => {
    await gatewayManager.createCurrentIfMissing();

    const gateway = await gatewayManager.getCurrent();

    await expect(Container.get(Config).get(ConfigKey.CURRENT_ID)).resolves.toEqual(gateway.id);
  });

  test('Custom gateway class should be returned', async () => {
    await gatewayManager.createCurrentIfMissing();

    await expect(gatewayManager.getCurrent()).resolves.toBeInstanceOf(PrivateGateway);
  });
});

describe('getCurrentChannel', () => {
  const pkiFixtureRetriever = generatePKIFixture();
  const { deletePrivateGateway, undoGatewayRegistration } =
    mockGatewayRegistration(pkiFixtureRetriever);

  test('Error should be thrown if private gateway is not initialised', async () => {
    await deletePrivateGateway();

    await expect(gatewayManager.getCurrentChannel()).rejects.toBeInstanceOf(MissingGatewayError);
  });

  test('Error should be thrown if gateway is not registered', async () => {
    await undoGatewayRegistration();
    await gatewayManager.createCurrentIfMissing();

    await expect(gatewayManager.getCurrentChannel()).rejects.toThrowWithMessage(
      UnregisteredGatewayError,
      'Private gateway is unregistered',
    );
  });

  test('Error should be thrown if channel could not be retrieved', async () => {
    await getRepository(IdentityPublicKey).clear();
    await gatewayManager.createCurrentIfMissing();

    await expect(gatewayManager.getCurrentChannel()).rejects.toThrowWithMessage(
      UnregisteredGatewayError,
      'Failed to retrieve channel; some keys may be missing',
    );
  });

  test('Channel should be returned if gateway is registered', async () => {
    const channel = await gatewayManager.getCurrentChannel();

    expect(channel.internetGatewayInternetAddress).toEqual(DEFAULT_INTERNET_GATEWAY_ADDRESS);
  });
});

describe('getCurrentChannelIfRegistered', () => {
  const pkiFixtureRetriever = generatePKIFixture();
  const { deletePrivateGateway, undoGatewayRegistration } =
    mockGatewayRegistration(pkiFixtureRetriever);

  test('Null should be returned if private gateway is unregistered', async () => {
    await undoGatewayRegistration();

    await expect(gatewayManager.getCurrentChannelIfRegistered()).resolves.toBeNull();
  });

  test('Channel should be returned if private gateway is registered', async () => {
    await expect(gatewayManager.getCurrentChannelIfRegistered()).resolves.toHaveProperty(
      'internetGatewayInternetAddress',
      DEFAULT_INTERNET_GATEWAY_ADDRESS,
    );
  });

  test('Non-registration-related errors should be propagated', async () => {
    await deletePrivateGateway();

    await expect(gatewayManager.getCurrentChannelIfRegistered()).rejects.toBeInstanceOf(
      MissingGatewayError,
    );
  });
});

describe('getVerifier', () => {
  beforeEach(async () => {
    await gatewayManager.createCurrentIfMissing();
  });

  test('Null should be returned if id of Internet gateway is unset', async () => {
    await expect(gatewayManager.getVerifier(StubVerifier)).resolves.toBeNull();
  });

  test('Verifier should be returned if id of Internet gateway is set', async () => {
    const internetGatewayId = '0deadbeef';
    const certificate = await selfIssuedCertificate();
    await Container.get(DBCertificateStore).save(
      new CertificationPath(certificate, []),
      internetGatewayId,
    );
    await Container.get(Config).set(ConfigKey.INTERNET_GATEWAY_ID, internetGatewayId);

    const verifier = await gatewayManager.getVerifier(StubVerifier);

    const trustedCertificates = verifier!.getTrustedCertificates();
    expect(trustedCertificates).toHaveLength(1);
    expect(certificate.isEqual(trustedCertificates[0])).toBeTrue();
  });

  async function selfIssuedCertificate(): Promise<Certificate> {
    const id = await Container.get(Config).get(ConfigKey.CURRENT_ID);
    const privateKey = await Container.get(DBPrivateKeyStore).retrieveIdentityKey(id!);
    return issueGatewayCertificate({
      issuerPrivateKey: privateKey!,
      subjectPublicKey: await getRSAPublicKeyFromPrivate(privateKey!),
      validityEndDate: addDays(new Date(), 1),
    });
  }

  class StubVerifier extends ParcelDeliveryVerifier {
    getTrustedCertificates(): readonly Certificate[] {
      return this.trustedCertificates;
    }
  }
});
