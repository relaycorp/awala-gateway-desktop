import {
  DBPublicKeyStore as BaseDBPublicKeyStore,
  IdentityPublicKey,
  SessionPublicKey,
} from '@relaycorp/keystore-db';
import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { InjectRepository } from 'typeorm-typedi-extensions';

@Service()
export class DBPublicKeyStore extends BaseDBPublicKeyStore {
  constructor(
    @InjectRepository(IdentityPublicKey) identityKeyRepository: Repository<IdentityPublicKey>,
    @InjectRepository(SessionPublicKey) sessionKeyRepository: Repository<SessionPublicKey>,
  ) {
    super(identityKeyRepository, sessionKeyRepository);
  }
}
