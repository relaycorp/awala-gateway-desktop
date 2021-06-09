import { PrivateKey } from '@relaycorp/keystore-db';
import { Certificate, derSerializePrivateKey } from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import { Container } from 'typedi';
import { getConnection, Repository } from 'typeorm';

import { Config, ConfigKey } from '../Config';
import { setUpTestDBConnection } from '../testUtils/db';
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

let nodeKeyPair: CryptoKeyPair;
let nodeCertificate: Certificate;
beforeAll(async () => {
  const pairSet = await generateNodeKeyPairSet();
  const certPath = await generatePDACertificationPath(pairSet);

  nodeKeyPair = pairSet.privateGateway;
  nodeCertificate = certPath.privateGateway;
});

describe('getCurrentIdKey', () => {
  test('Null should be returned if no current key has been set', async () => {
    await expect(keystore.getCurrentKey()).resolves.toBeNull();
  });

  test('Current key should be returned if found', async () => {
    await keystore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);
    await config.set(ConfigKey.NODE_KEY_SERIAL_NUMBER, nodeCertificate.getSerialNumberHex());

    const key = await keystore.getCurrentKey();

    expect(key).toBeTruthy();
    expect(key!.certificate.isEqual(nodeCertificate));
    await expect(derSerializePrivateKey(key!.privateKey)).resolves.toEqual(
      await derSerializePrivateKey(nodeKeyPair.privateKey),
    );
  });
});
