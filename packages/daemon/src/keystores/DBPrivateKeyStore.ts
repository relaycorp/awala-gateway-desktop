import {
  BoundPrivateKeyData,
  Certificate,
  PrivateKeyData,
  PrivateKeyStore,
  UnboundKeyPair,
  UnboundPrivateKeyData,
} from '@relaycorp/relaynet-core';
import { Inject, Service } from 'typedi';
import { Connection, Repository } from 'typeorm';
import { InjectConnection } from 'typeorm-typedi-extensions';

import bufferToArray from 'buffer-to-arraybuffer';
import { Config, ConfigKey } from '../Config';
import { PrivateKey, PrivateKeyType } from '../entity/PrivateKey';

@Service()
export class DBPrivateKeyStore extends PrivateKeyStore {
  private readonly repository: Repository<PrivateKey>;

  constructor(@InjectConnection() connection: Connection, @Inject() protected config: Config) {
    super();

    this.repository = connection.getRepository(PrivateKey);
  }

  public async getCurrentKey(): Promise<UnboundKeyPair | null> {
    const keyId = await this.config.get(ConfigKey.NODE_KEY_SERIAL_NUMBER);
    if (!keyId) {
      return null;
    }
    return this.fetchNodeKey(Buffer.from(keyId, 'hex'));
  }

  public async fetchNodeCertificates(): Promise<readonly Certificate[]> {
    const keys = await this.repository.find({ type: PrivateKeyType.NODE });
    const certificateDeserializationPromises = keys.map((k) =>
      Certificate.deserialize(bufferToArray(k.certificateDer!!)),
    );
    return Promise.all(certificateDeserializationPromises);
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

    if (privateKeyData.type === 'node') {
      await this.config.set(ConfigKey.NODE_KEY_SERIAL_NUMBER, keyId);
    }
  }
}
