import {
  derSerializePrivateKey,
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

let cryptoKey: CryptoKey;
let certPath: PDACertPath;
beforeAll(async () => {
  const pairSet = await generateNodeKeyPairSet();
  certPath = await generatePDACertificationPath(pairSet);

  cryptoKey = pairSet.privateGateway.privateKey;
});

const KEY_ID = Buffer.from('the id');
let basePrivateKeyData: Partial<PrivateKey>;
beforeAll(async () => {
  basePrivateKeyData = {
    certificateDer: Buffer.from(certPath.privateGateway.serialize()),
    derSerialization: await derSerializePrivateKey(cryptoKey),
    id: KEY_ID.toString('hex'),
  };
});

async function savePrivateKey(privateKeyData: Partial<PrivateKey>): Promise<void> {
  const privateKey = await privateKeyRepository.create(privateKeyData);
  await privateKeyRepository.save(privateKey);
}

describe('fetchKey', () => {
  test('Node key should be returned', async () => {
    await savePrivateKey({ ...basePrivateKeyData, type: PrivateKeyType.NODE });

    const key = await keystore.fetchNodeKey(KEY_ID);
    await expect(derSerializePrivateKey(key.privateKey)).resolves.toEqual(
      await derSerializePrivateKey(cryptoKey),
    );
    await expect(key.certificate.isEqual(certPath.privateGateway)).toBeTruthy();
  });

  test('Initial session key should be returned', async () => {
    await savePrivateKey({
      ...basePrivateKeyData,
      type: PrivateKeyType.SESSION_INITIAL,
    });

    await expect(keystore.fetchInitialSessionKey(KEY_ID)).resolves.toEqual(
      basePrivateKeyData.derSerialization,
    );
  });

  test('Subsequent session key should be returned', async () => {
    await savePrivateKey({
      ...basePrivateKeyData,
      certificateDer: undefined,
      recipientPublicKeyDigest: await certPath.publicGateway.getSerialNumberHex(),
      type: PrivateKeyType.SESSION_SUBSEQUENT,
    });

    await expect(keystore.fetchSessionKey(KEY_ID, certPath.publicGateway)).resolves.toEqual(
      basePrivateKeyData.derSerialization,
    );
  });

  test('Lookup should fail if key is bound to different recipient', async () => {
    const recipientPublicKeyDigest = 'foo';
    await savePrivateKey({
      ...basePrivateKeyData,
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
});

describe('saveKey', () => {
  test.todo('Id should be stored');

  test.todo('Type should be stored');

  test.todo('Key should be stored');

  test.todo('Recipient public key digest should be saved if key is bound');

  test.todo('Certificate should be saved if key is unbound');
});
