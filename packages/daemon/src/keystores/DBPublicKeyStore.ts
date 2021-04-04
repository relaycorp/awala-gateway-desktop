import { PublicKeyStore, SessionPublicKeyData } from '@relaycorp/relaynet-core';
import { Connection, Repository } from 'typeorm';

import { PublicKey } from '../entity/PublicKey';

export class DBPublicKeyStore extends PublicKeyStore {
  private readonly repository: Repository<PublicKey>;

  constructor(connection: Connection) {
    super();

    this.repository = connection.getRepository(PublicKey);
  }

  protected async fetchKey(peerPrivateAddress: string): Promise<SessionPublicKeyData | null> {
    const publicKey = await this.repository.findOne(peerPrivateAddress);
    if (publicKey === undefined) {
      return null;
    }
    return {
      publicKeyCreationTime: publicKey!.creationDate,
      publicKeyDer: publicKey!.derSerialization,
      publicKeyId: publicKey!.id,
    };
  }

  protected async saveKey(
    keyData: SessionPublicKeyData,
    peerPrivateAddress: string,
  ): Promise<void> {
    const publicKey = await this.repository.create({
      creationDate: keyData.publicKeyCreationTime,
      derSerialization: keyData.publicKeyDer,
      id: keyData.publicKeyId,
      peerPrivateAddress,
    });
    await this.repository.save(publicKey);
  }
}
