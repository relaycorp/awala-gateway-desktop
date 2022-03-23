import { DBPrivateKeyStore as BaseDBPrivateKeyStore, PrivateKey } from '@relaycorp/keystore-db';
import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { InjectRepository } from 'typeorm-typedi-extensions';

@Service()
export class DBPrivateKeyStore extends BaseDBPrivateKeyStore {
  constructor(@InjectRepository(PrivateKey) repository: Repository<PrivateKey>) {
    super(repository);
  }
}
