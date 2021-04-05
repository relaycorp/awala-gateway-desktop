import {
  BoundPrivateKeyData,
  PrivateKeyData,
  PrivateKeyStore,
  UnboundPrivateKeyData,
} from '@relaycorp/relaynet-core';
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
      type: key.type as PrivateKeyType.NODE | PrivateKeyType.SESSION_INITIAL,
    };
  }

  protected async saveKey(privateKeyData: PrivateKeyData, keyId: string): Promise<void> {
    const privateKey = await this.repository.create({
      certificateDer: (privateKeyData as UnboundPrivateKeyData).certificateDer,
      derSerialization: privateKeyData.keyDer,
      id: keyId,
      recipientPublicKeyDigest: (privateKeyData as BoundPrivateKeyData).recipientPublicKeyDigest,
      type: privateKeyData.type as PrivateKeyType,
    });
    await this.repository.save(privateKey);
  }
}
