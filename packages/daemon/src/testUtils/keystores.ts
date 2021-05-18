import { MockPrivateKeyStore, PrivateKeyStore } from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';

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
