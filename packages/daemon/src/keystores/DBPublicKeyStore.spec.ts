import {
  Certificate,
  derSerializePublicKey,
  generateECDHKeyPair,
  generateRSAKeyPair,
  issueGatewayCertificate,
  OriginatorSessionKey,
} from '@relaycorp/relaynet-core';
import { getConnection, Repository } from 'typeorm';

import { PublicKey } from '../entity/PublicKey';
import { setUpTestDBConnection } from '../testUtils/db';
import { DBPublicKeyStore } from './DBPublicKeyStore';

setUpTestDBConnection();

let keystore: DBPublicKeyStore;
let publicKeyRepository: Repository<PublicKey>;
beforeEach(() => {
  const connection = getConnection();
  keystore = new DBPublicKeyStore(connection);
  publicKeyRepository = connection.getRepository(PublicKey);
});

let peerIdentityCertificate: Certificate;
let peerSessionPublicKey: CryptoKey;
beforeAll(async () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const keyPair = await generateRSAKeyPair();
  peerIdentityCertificate = await issueGatewayCertificate({
    issuerPrivateKey: keyPair.privateKey,
    subjectPublicKey: keyPair.publicKey,
    validityEndDate: tomorrow,
  });

  const sessionKeyPair = await generateECDHKeyPair();
  peerSessionPublicKey = sessionKeyPair.publicKey;
});

const KEY_ID = Buffer.from([1, 3, 5, 7, 9]);
let peerSessionKey: OriginatorSessionKey;
beforeAll(() => {
  peerSessionKey = { keyId: KEY_ID, publicKey: peerSessionPublicKey };
});

describe('fetchKey', () => {
  test('Existing key should be returned', async () => {
    await keystore.saveSessionKey(peerSessionKey, peerIdentityCertificate, new Date());

    const key = await keystore.fetchLastSessionKey(peerIdentityCertificate);

    expect(key?.keyId).toEqual(KEY_ID);
    await expect(derSerializePublicKey(key!.publicKey)).resolves.toEqual(
      await derSerializePublicKey(peerSessionPublicKey),
    );
  });

  test('Non-existing key should result in null', async () => {
    await expect(keystore.fetchLastSessionKey(peerIdentityCertificate)).resolves.toBeNull();
  });
});

describe('saveKey', () => {
  test('Key should be created if it does not exist', async () => {
    const creationDate = new Date();

    await keystore.saveSessionKey(peerSessionKey, peerIdentityCertificate, creationDate);

    const key = await publicKeyRepository.findOne(
      await peerIdentityCertificate.calculateSubjectPrivateAddress(),
    );
    expect(key?.creationDate).toEqual(creationDate);
    expect(key?.id).toEqual(KEY_ID);
    expect(key?.derSerialization).toEqual(await derSerializePublicKey(peerSessionPublicKey));
  });

  test('Key should be updated if it already exists', async () => {
    const oldCreationDate = new Date();
    oldCreationDate.setHours(oldCreationDate.getHours() - 1);
    const newCreationDate = new Date();

    await keystore.saveSessionKey(peerSessionKey, peerIdentityCertificate, oldCreationDate);
    await keystore.saveSessionKey(peerSessionKey, peerIdentityCertificate, newCreationDate);

    const key = await publicKeyRepository.findOne(
      await peerIdentityCertificate.calculateSubjectPrivateAddress(),
    );
    expect(key?.creationDate).toEqual(newCreationDate);
  });
});
