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

// TODO: DELETE
const KEY_ID = Buffer.from('the id');
const KEY_ID_HEX = KEY_ID.toString('hex');
let basePrivateKeyData: Partial<PrivateKey>;
beforeAll(async () => {
  basePrivateKeyData = { id: KEY_ID_HEX };
});

describe('fetchKey', () => {
  test('Node key should be returned', async () => {
    const privateKeySerialized = await derSerializePrivateKey(nodeKeyPair.privateKey);
    await savePrivateKey({
      ...basePrivateKeyData,
      certificateDer: Buffer.from(nodeCertificate.serialize()),
      derSerialization: privateKeySerialized,
      type: PrivateKeyType.NODE,
    });

    const key = await keystore.fetchNodeKey(KEY_ID);

    await expect(derSerializePrivateKey(key.privateKey)).resolves.toEqual(privateKeySerialized);
    await expect(key.certificate.isEqual(nodeCertificate)).toBeTruthy();
  });

  test('Initial session key should be returned', async () => {
    await savePrivateKey({
      ...basePrivateKeyData,
      certificateDer: Buffer.from(sessionKeyInitialCertificate.serialize()),
      derSerialization: await derSerializePrivateKey(sessionKeyPair.privateKey),
      type: PrivateKeyType.SESSION_INITIAL,
    });

    const key = await keystore.fetchInitialSessionKey(KEY_ID);

    await expect(derSerializePrivateKey(key.privateKey)).resolves.toEqual(
      await derSerializePrivateKey(sessionKeyPair.privateKey),
    );
    await expect(key.certificate.isEqual(sessionKeyInitialCertificate)).toBeTruthy();
  });

  test('Subsequent session key should be returned', async () => {
    const recipientPublicKeyDer = await derSerializePublicKey(
      await recipientNodeCertificate.getPublicKey(),
    );
    const privateKeySerialized = await derSerializePrivateKey(sessionKeyPair.privateKey);
    await savePrivateKey({
      ...basePrivateKeyData,
      derSerialization: privateKeySerialized,
      recipientPublicKeyDigest: sha256Hex(recipientPublicKeyDer),
      type: PrivateKeyType.SESSION_SUBSEQUENT,
    });

    const key = await keystore.fetchSessionKey(KEY_ID, recipientNodeCertificate);

    await expect(derSerializePrivateKey(key)).resolves.toEqual(privateKeySerialized);
  });

  test('Lookup should fail if key is bound to different recipient', async () => {
    const recipientPublicKeyDigest = 'foo';
    await savePrivateKey({
      ...basePrivateKeyData,
      derSerialization: await derSerializePrivateKey(sessionKeyPair.privateKey),
      recipientPublicKeyDigest,
      type: PrivateKeyType.SESSION_SUBSEQUENT,
    });

    await expect(keystore.fetchSessionKey(KEY_ID, recipientNodeCertificate)).rejects.toEqual(
      new PrivateKeyStoreError('Key is bound to another recipient'),
    );
  });

  test('UnknownKeyError should be raised if record is missing', async () => {
    await expect(keystore.fetchNodeKey(Buffer.from('missing'))).rejects.toBeInstanceOf(
      UnknownKeyError,
    );
  });

  async function savePrivateKey(privateKeyData: Partial<PrivateKey>): Promise<void> {
    const privateKey = await privateKeyRepository.create(privateKeyData);
    await privateKeyRepository.save(privateKey);
  }
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
      KEY_ID,
      recipientNodeCertificate,
    );

    const key = await privateKeyRepository.findOne(KEY_ID_HEX);
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
