import {
  derSerializePrivateKey,
  derSerializePublicKey,
  generateECDHKeyPair,
  issueInitialDHKeyCertificate,
  PrivateKeyStoreError,
  UnknownKeyError,
} from '@relaycorp/relaynet-core';
import {
  generateNodeKeyPairSet,
  generatePDACertificationPath,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
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

let certPath: PDACertPath;
let nodeKeyPair: CryptoKeyPair;
let sessionKeyPair: CryptoKeyPair;
beforeAll(async () => {
  const pairSet = await generateNodeKeyPairSet();
  certPath = await generatePDACertificationPath(pairSet);

  nodeKeyPair = pairSet.privateGateway;

  sessionKeyPair = await generateECDHKeyPair();
});

const KEY_ID = Buffer.from('the id');
let basePrivateKeyData: Partial<PrivateKey>;
beforeAll(async () => {
  basePrivateKeyData = {
    id: KEY_ID.toString('hex'),
  };
});

describe('fetchKey', () => {
  test('Node key should be returned', async () => {
    const privateKeySerialized = await derSerializePrivateKey(nodeKeyPair.privateKey);
    await savePrivateKey({
      ...basePrivateKeyData,
      certificateDer: Buffer.from(certPath.privateGateway.serialize()),
      derSerialization: privateKeySerialized,
      type: PrivateKeyType.NODE,
    });

    const key = await keystore.fetchNodeKey(KEY_ID);

    await expect(derSerializePrivateKey(key.privateKey)).resolves.toEqual(privateKeySerialized);
    await expect(key.certificate.isEqual(certPath.privateGateway)).toBeTruthy();
  });

  test('Initial session key should be returned', async () => {
    const sessionKeyCertificate = await issueInitialDHKeyCertificate({
      issuerCertificate: certPath.privateGateway,
      issuerPrivateKey: nodeKeyPair.privateKey,
      subjectPublicKey: sessionKeyPair.publicKey,
      validityEndDate: certPath.privateGateway.expiryDate,
    });
    await savePrivateKey({
      ...basePrivateKeyData,
      certificateDer: Buffer.from(sessionKeyCertificate.serialize()),
      derSerialization: await derSerializePrivateKey(sessionKeyPair.privateKey),
      type: PrivateKeyType.SESSION_INITIAL,
    });

    const key = await keystore.fetchInitialSessionKey(KEY_ID);

    await expect(derSerializePrivateKey(key.privateKey)).resolves.toEqual(
      await derSerializePrivateKey(sessionKeyPair.privateKey),
    );
    await expect(key.certificate.isEqual(sessionKeyCertificate)).toBeTruthy();
  });

  test('Subsequent session key should be returned', async () => {
    const recipientPublicKeyDer = await derSerializePublicKey(
      await certPath.publicGateway.getPublicKey(),
    );
    const privateKeySerialized = await derSerializePrivateKey(sessionKeyPair.privateKey);
    await savePrivateKey({
      ...basePrivateKeyData,
      derSerialization: privateKeySerialized,
      recipientPublicKeyDigest: sha256Hex(recipientPublicKeyDer),
      type: PrivateKeyType.SESSION_SUBSEQUENT,
    });

    const key = await keystore.fetchSessionKey(KEY_ID, certPath.publicGateway);

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

    await expect(keystore.fetchSessionKey(KEY_ID, certPath.publicGateway)).rejects.toEqual(
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
  test.todo('Id should be stored');

  test.todo('Type should be stored');

  test.todo('Key should be stored');

  test.todo('Recipient public key digest should be saved if key is bound');

  test.todo('Certificate should be saved if key is unbound');
});
