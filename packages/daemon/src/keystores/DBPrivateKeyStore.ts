import {
  DBPrivateKeyStore as BaseDBPrivateKeyStore,
  IdentityPrivateKey,
  SessionPrivateKey,
} from '@relaycorp/keystore-db';
import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { InjectRepository } from 'typeorm-typedi-extensions';

@Service()
export class DBPrivateKeyStore extends BaseDBPrivateKeyStore {
  constructor(
    @InjectRepository(IdentityPrivateKey) identityKeyRepo: Repository<IdentityPrivateKey>,
    @InjectRepository(SessionPrivateKey) sessionKeyRepo: Repository<SessionPrivateKey>,
  ) {
    super(identityKeyRepo, sessionKeyRepo);
  }
}
