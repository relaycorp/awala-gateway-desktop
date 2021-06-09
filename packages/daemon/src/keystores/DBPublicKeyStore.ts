import { DBPublicKeyStore as BaseDBPublicKeyStore, PublicKey } from '@relaycorp/keystore-db';
import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { InjectRepository } from 'typeorm-typedi-extensions';

@Service()
export class DBPublicKeyStore extends BaseDBPublicKeyStore {
  constructor(@InjectRepository(PublicKey) repository: Repository<PublicKey>) {
    super(repository);
  }
}
