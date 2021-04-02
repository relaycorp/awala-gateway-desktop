import { PrivateKeyData, PrivateKeyStore } from '@relaycorp/relaynet-core';
import { Connection, Repository } from 'typeorm';
import { PrivateKey, PrivateKeyType } from '../entity/PrivateKey';

export class DBPrivateKeyStore extends PrivateKeyStore {
  private readonly repository: Repository<PrivateKey>;

  constructor(connection: Connection) {
    super();

    this.repository = connection.getRepository(PrivateKey);
  }

  protected async fetchKey(keyId: string): Promise<PrivateKeyData | null> {
    const key = await this.repository.findOne(keyId);
    if (key === undefined) {
      return null;
    }
    if (key.type === PrivateKeyType.SESSION_SUBSEQUENT) {
      return {
        keyDer: key.derSerialization,
        recipientPublicKeyDigest: key.recipientPublicKeyDigest!!,
        type: PrivateKeyType.SESSION_SUBSEQUENT,
      };
    }
    return {
      certificateDer: key.certificateDer!!,
      keyDer: key.derSerialization,
      type: key.type as any,
    };
  }

  protected async saveKey(_privateKeyData: PrivateKeyData, _keyId: string): Promise<void> {
    return Promise.resolve(undefined);
  }
}
