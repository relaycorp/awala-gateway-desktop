import { DBPrivateKeyStore as BaseDBPrivateKeyStore, PrivateKey } from '@relaycorp/keystore-db';
import { UnboundKeyPair } from '@relaycorp/relaynet-core';
import { Inject, Service } from 'typedi';
import { Repository } from 'typeorm';
import { InjectRepository } from 'typeorm-typedi-extensions';

import { Config, ConfigKey } from '../Config';

@Service()
export class DBPrivateKeyStore extends BaseDBPrivateKeyStore {
  constructor(
    @InjectRepository(PrivateKey) repository: Repository<PrivateKey>,
    @Inject() protected config: Config,
  ) {
    super(repository);
  }

  public async getCurrentKey(): Promise<UnboundKeyPair | null> {
    const keyId = await this.config.get(ConfigKey.NODE_KEY_SERIAL_NUMBER);
    if (!keyId) {
      return null;
    }
    return this.fetchNodeKey(Buffer.from(keyId, 'hex'));
  }
}
