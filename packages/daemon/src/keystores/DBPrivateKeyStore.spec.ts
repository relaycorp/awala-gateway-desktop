import {
  Certificate,
  derSerializePrivateKey,
  derSerializePublicKey,
  generateECDHKeyPair,
  issueInitialDHKeyCertificate,
  PrivateKeyStoreError,
  UnknownKeyError,
} from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import { getConnection, Repository } from 'typeorm';

import { PrivateKey, PrivateKeyType } from '../entity/PrivateKey';
import { sha256Hex } from '../testUtils/crypto';
import { setUpTestDBConnection } from '../testUtils/db';
import { DBPrivateKeyStore } from './DBPrivateKeyStore';

setUpTestDBConnection();

let keystore: DBPrivateKeyStore;
let privateKeyRepository: Repository<PrivateKey>;
beforeEach(() => {
  const connection = getConnection();
  keystore = new DBPrivateKeyStore(connection);
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
  });

  test('Subsequent session key should have all its attributes stored', async () => {
    await keystore.saveSubsequentSessionKey(
      sessionKeyPair.privateKey,
      SUBSEQUENT_KEY_ID,
      recipientNodeCertificate,
    );

    const key = await privateKeyRepository.findOne(SUBSEQUENT_KEY_ID.toString('hex'));
    const recipientPublicKeyDer = await derSerializePublicKey(
      await recipientNodeCertificate.getPublicKey(),
    );
    expect(key).toMatchObject<Partial<PrivateKey>>({
      certificateDer: null,
      derSerialization: await derSerializePrivateKey(sessionKeyPair.privateKey),
      recipientPublicKeyDigest: sha256Hex(recipientPublicKeyDer),
      type: PrivateKeyType.SESSION_SUBSEQUENT,
    });
  });

  test('Key should be updated if it already exists', async () => {
    await keystore.saveNodeKey(nodeKeyPair.privateKey, nodeCertificate);
    const newPrivateKey = sessionKeyPair.privateKey;
    await keystore.saveNodeKey(newPrivateKey, nodeCertificate);

    const key = await privateKeyRepository.findOne(nodeCertificate.getSerialNumberHex());
    expect(key!.derSerialization).toEqual(await derSerializePrivateKey(newPrivateKey));
  });
});
