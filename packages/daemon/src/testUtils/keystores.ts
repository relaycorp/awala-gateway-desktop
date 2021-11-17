import {
  MockPrivateKeyStore,
  MockPublicKeyStore,
  PrivateKeyStore,
  PublicKeyStore,
} from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';

export function mockPrivateKeyStore(): MockPrivateKeyStore {
  let originalKeyStore: PrivateKeyStore;

  const privateKeyStore = new MockPrivateKeyStore();

  beforeAll(() => {
    originalKeyStore = Container.get(DBPrivateKeyStore);

    Container.set(DBPrivateKeyStore, privateKeyStore);
  });

  beforeEach(() => {
    privateKeyStore.clear();
  });

  afterAll(() => {
    Container.set(DBPrivateKeyStore, originalKeyStore);
  });

  return privateKeyStore;
}

export function mockPublicKeyStore(): MockPublicKeyStore {
  let originalKeyStore: PublicKeyStore;

  const keyStore = new MockPublicKeyStore();

  beforeAll(() => {
    originalKeyStore = Container.get(DBPublicKeyStore);

    Container.set(DBPublicKeyStore, keyStore);
  });

  beforeEach(() => {
    keyStore.clear();
  });

  afterAll(() => {
    Container.set(DBPublicKeyStore, originalKeyStore);
  });

  return keyStore;
}
