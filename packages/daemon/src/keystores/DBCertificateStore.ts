import {
  Certificate as CertificateEntity,
  DBCertificateStore as BaseDBCertificateStore,
} from '@relaycorp/keystore-db';
import { Service } from 'typedi';
import { InjectRepository } from 'typeorm-typedi-extensions';
import { Repository } from 'typeorm';

@Service()
export class DBCertificateStore extends BaseDBCertificateStore {
  constructor(@InjectRepository(CertificateEntity) repository: Repository<CertificateEntity>) {
    super(repository);
  }
}
