import { Container } from 'typedi';

import { PrivateGatewayManager } from './PrivateGatewayManager';
import { setUpTestDBConnection } from './testUtils/db';
import { Config, ConfigKey } from './Config';
import { MissingGatewayError } from './errors';
import {
  Certificate,
  getRSAPublicKeyFromPrivate,
  issueGatewayCertificate,
  ParcelDeliveryVerifier,
} from '@relaycorp/relaynet-core';
import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import { addDays } from 'date-fns';
import { DBCertificateStore } from './keystores/DBCertificateStore';

setUpTestDBConnection();

let gatewayManager: PrivateGatewayManager;
beforeEach(() => {
  gatewayManager = Container.get(PrivateGatewayManager);
});

describe('createCurrentIfMissing', () => {
  test('Node should be created if private address is absent', async () => {
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS)).resolves.toBeNull();

    await gatewayManager.createCurrentIfMissing();

    const privateAddress = await config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS);
    expect(privateAddress).toBeTruthy();
    await expect(gatewayManager.get(privateAddress!)).resolves.not.toBeNull();
  });

  test('Node should be created if private key does not', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.CURRENT_PRIVATE_ADDRESS, '0deadbeef');

    await gatewayManager.createCurrentIfMissing();

    const privateAddress = await config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS);
    await expect(gatewayManager.get(privateAddress!)).resolves.not.toBeNull();
  });

  test('Node should be reused if it already exists', async () => {
    await gatewayManager.createCurrentIfMissing();
    const config = Container.get(Config);
    const originalPrivateAddress = await config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS);

    await gatewayManager.createCurrentIfMissing();

    const newPrivateAddress = await config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS);
    expect(newPrivateAddress).toBeTruthy();
    expect(newPrivateAddress).toEqual(originalPrivateAddress);
  });
});

describe('getCurrent', () => {
  test('Error should be thrown if private address is absent', async () => {
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS)).resolves.toBeNull();

    await expect(gatewayManager.getCurrent()).rejects.toThrowWithMessage(
      MissingGatewayError,
      'Config does not contain current private address',
    );
  });

  test('Error should be thrown if private key is absent', async () => {
    const privateAddress = '0deadbeef';
    await Container.get(Config).set(ConfigKey.CURRENT_PRIVATE_ADDRESS, privateAddress);

    await expect(gatewayManager.getCurrent()).rejects.toThrowWithMessage(
      MissingGatewayError,
      `Private key (${privateAddress}) is missing`,
    );
  });

  test('Existing gateway should be returned', async () => {
    await gatewayManager.createCurrentIfMissing();

    const gateway = await gatewayManager.getCurrent();

    await expect(Container.get(Config).get(ConfigKey.CURRENT_PRIVATE_ADDRESS)).resolves.toEqual(
      gateway.privateAddress,
    );
  });
});

describe('getVerifier', () => {
  beforeEach(async () => {
    await gatewayManager.createCurrentIfMissing();
  });

  test('Null should be returned if private address of public gateway is unset', async () => {
    await expect(gatewayManager.getVerifier(StubVerifier)).resolves.toBeNull();
  });

  test('Verifier should be returned if private address of public gateway is set', async () => {
    const publicGatewayPrivateAddress = '0deadbeef';
    const certificate = await selfIssuedCertificate();
    await Container.get(DBCertificateStore).save(certificate, publicGatewayPrivateAddress);
    await Container.get(Config).set(
      ConfigKey.PUBLIC_GATEWAY_PRIVATE_ADDRESS,
      publicGatewayPrivateAddress,
    );

    const verifier = await gatewayManager.getVerifier(StubVerifier);

    const trustedCertificates = verifier!.getTrustedCertificates();
    expect(trustedCertificates).toHaveLength(1);
    expect(certificate.isEqual(trustedCertificates[0])).toBeTrue();
  });

  async function selfIssuedCertificate(): Promise<Certificate> {
    const privateAddress = await Container.get(Config).get(ConfigKey.CURRENT_PRIVATE_ADDRESS);
    const privateKey = await Container.get(DBPrivateKeyStore).retrieveIdentityKey(privateAddress!);
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
