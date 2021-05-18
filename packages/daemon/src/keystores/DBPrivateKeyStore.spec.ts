import {
  Certificate,
  derSerializePrivateKey,
  generateECDHKeyPair,
  getPublicKeyDigestHex,
  issueInitialDHKeyCertificate,
  PrivateKeyStoreError,
  UnknownKeyError,
} from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import { Container } from 'typedi';
import { getConnection, Repository } from 'typeorm';

import { Config, ConfigKey } from '../Config';
import { PrivateKey, PrivateKeyType } from '../entity/PrivateKey';
import { setUpTestDBConnection } from '../testUtils/db';
import { DBPrivateKeyStore } from './DBPrivateKeyStore';

setUpTestDBConnection();

let keystore: DBPrivateKeyStore;
let privateKeyRepository: Repository<PrivateKey>;
beforeEach(() => {
  const connection = getConnection();
  keystore = new DBPrivateKeyStore(connection, Container.get(Config));
  privateKeyRepository = connection.getRepository(PrivateKey);
});

let nodeKeyPair: CryptoKeyPair;
let nodeCertificate: Certificate;
let sessionKeyPair: CryptoKeyPair;
let sessionKeyInitialCertificate: Certificate;
let recipientNodeCertificate: Certificate;
beforeAll(async () => {
  const pairSet = await generateNodeKeyPairSet();
  const certPath = await generatePDACertificationPath(pairSet);

  nodeKeyPair = pairSet.privateGateway;
  nodeCertificate = certPath.privateGateway;

  sessionKeyPair = await generateECDHKeyPair();
  sessionKeyInitialCertificate = await issueInitialDHKeyCertificate({
    issuerCertificate: nodeCertificate,
    issuerPrivateKey: nodeKeyPair.privateKey,
    subjectPublicKey: sessionKeyPair.publicKey,
    validityEndDate: nodeCertificate.expiryDate,
  });

  recipientNodeCertificate = certPath.publicGateway;
});

const SUBSEQUENT_KEY_ID = Buffer.from('the id');

describe('fetchKey', () => {
  test('Node key should be returned', async () => {
    await keystore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);

    const key = await keystore.fetchNodeKey(nodeCertificate.getSerialNumber());

    await expect(derSerializePrivateKey(key.privateKey)).resolves.toEqual(
      await derSerializePrivateKey(nodeKeyPair.privateKey),
    );
    await expect(key.certificate.isEqual(nodeCertificate)).toBeTruthy();
  });

  test('Initial session key should be returned', async () => {
    await keystore.saveInitialSessionKey(sessionKeyPair.privateKey, sessionKeyInitialCertificate);

    const key = await keystore.fetchInitialSessionKey(
      sessionKeyInitialCertificate.getSerialNumber(),
    );

    await expect(derSerializePrivateKey(key.privateKey)).resolves.toEqual(
      await derSerializePrivateKey(sessionKeyPair.privateKey),
    );
    await expect(key.certificate.isEqual(sessionKeyInitialCertificate)).toBeTruthy();
  });

  test('Subsequent session key should be returned', async () => {
    await keystore.saveSubsequentSessionKey(
      sessionKeyPair.privateKey,
      SUBSEQUENT_KEY_ID,
      recipientNodeCertificate,
    );

    const key = await keystore.fetchSessionKey(SUBSEQUENT_KEY_ID, recipientNodeCertificate);

    await expect(derSerializePrivateKey(key)).resolves.toEqual(
      await derSerializePrivateKey(sessionKeyPair.privateKey),
    );
  });

  test('Lookup should fail if key is bound to different recipient', async () => {
    await keystore.saveSubsequentSessionKey(
      sessionKeyPair.privateKey,
      SUBSEQUENT_KEY_ID,
      recipientNodeCertificate,
    );

    await expect(keystore.fetchSessionKey(SUBSEQUENT_KEY_ID, nodeCertificate)).rejects.toEqual(
      new PrivateKeyStoreError('Key is bound to another recipient'),
    );
  });

  test('UnknownKeyError should be raised if record is missing', async () => {
    await expect(keystore.fetchNodeKey(Buffer.from('missing'))).rejects.toBeInstanceOf(
      UnknownKeyError,
    );
  });
});

describe('saveKey', () => {
  test('Node key should have all its attributes stored', async () => {
    await keystore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);

    const key = await privateKeyRepository.findOne(nodeCertificate.getSerialNumberHex());
    expect(key).toMatchObject<Partial<PrivateKey>>({
      certificateDer: Buffer.from(nodeCertificate.serialize()),
      derSerialization: await derSerializePrivateKey(nodeKeyPair.privateKey),
      recipientPublicKeyDigest: null,
      type: PrivateKeyType.NODE,
    });
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.NODE_KEY_SERIAL_NUMBER)).resolves.toEqual(
      nodeCertificate.getSerialNumberHex(),
    );
  });

  test('Initial session key should have all its attributes stored', async () => {
    await keystore.saveInitialSessionKey(sessionKeyPair.privateKey, sessionKeyInitialCertificate);

    const key = await privateKeyRepository.findOne(
      sessionKeyInitialCertificate.getSerialNumberHex(),
    );
    expect(key).toMatchObject<Partial<PrivateKey>>({
      certificateDer: Buffer.from(sessionKeyInitialCertificate.serialize()),
      derSerialization: await derSerializePrivateKey(sessionKeyPair.privateKey),
      recipientPublicKeyDigest: null,
      type: PrivateKeyType.SESSION_INITIAL,
    });
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.NODE_KEY_SERIAL_NUMBER)).resolves.toBeNull();
  });

  test('Subsequent session key should have all its attributes stored', async () => {
    await keystore.saveSubsequentSessionKey(
      sessionKeyPair.privateKey,
      SUBSEQUENT_KEY_ID,
      recipientNodeCertificate,
    );

    const key = await privateKeyRepository.findOne(SUBSEQUENT_KEY_ID.toString('hex'));
    const recipientPublicKeyDigest = await getPublicKeyDigestHex(
      await recipientNodeCertificate.getPublicKey(),
    );
    expect(key).toMatchObject<Partial<PrivateKey>>({
      certificateDer: null,
      derSerialization: await derSerializePrivateKey(sessionKeyPair.privateKey),
      recipientPublicKeyDigest,
      type: PrivateKeyType.SESSION_SUBSEQUENT,
    });
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.NODE_KEY_SERIAL_NUMBER)).resolves.toBeNull();
  });

  test('Key should be updated if it already exists', async () => {
    await keystore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);
    const newPrivateKey = sessionKeyPair.privateKey;
    await keystore.saveNodeKey(newPrivateKey, nodeCertificate);

    const key = await privateKeyRepository.findOne(nodeCertificate.getSerialNumberHex());
    expect(key!.derSerialization).toEqual(await derSerializePrivateKey(newPrivateKey));
  });
});

describe('getCurrentIdKey', () => {
  test('Null should be returned if no current key has been set', async () => {
    await expect(keystore.getCurrentKey()).resolves.toBeNull();
  });

  test('Current key should be returned if found', async () => {
    await keystore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);

    const key = await keystore.getCurrentKey();

    expect(key).toBeTruthy();
    expect(key!.certificate.isEqual(nodeCertificate));
    await expect(derSerializePrivateKey(key!.privateKey)).resolves.toEqual(
      await derSerializePrivateKey(nodeKeyPair.privateKey),
    );
  });
});

describe('fetchNodeCertificates', () => {
  test('Nothing should be output if there are no node keys', async () => {
    const certificates = await keystore.fetchNodeCertificates();

    expect(certificates).toHaveLength(0);
  });

  test('Node certificates should be output if there are node keys', async () => {
    await keystore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);

    const certificates = await keystore.fetchNodeCertificates();

    expect(certificates).toHaveLength(1);
    expect(nodeCertificate.isEqual(certificates[0])).toBeTrue();
  });

  test('Certificates for initial session keys should be ignored', async () => {
    await keystore.saveInitialSessionKey(sessionKeyPair.privateKey, sessionKeyInitialCertificate);
    await keystore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);

    const certificates = await keystore.fetchNodeCertificates();

    expect(certificates).toHaveLength(1);
    expect(nodeCertificate.isEqual(certificates[0])).toBeTrue();
  });

  test('Certificates for subsequent session keys should be ignored', async () => {
    await keystore.saveSubsequentSessionKey(
      sessionKeyPair.privateKey,
      SUBSEQUENT_KEY_ID,
      recipientNodeCertificate,
    );
    await keystore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);

    const certificates = await keystore.fetchNodeCertificates();

    expect(certificates).toHaveLength(1);
    expect(nodeCertificate.isEqual(certificates[0])).toBeTrue();
  });
});
