import { DBPrivateKeyStore as BaseDBPrivateKeyStore, PrivateKey } from '@relaycorp/keystore-db';
import { Certificate, issueGatewayCertificate, UnboundKeyPair } from '@relaycorp/relaynet-core';
import { addMonths, subMinutes } from 'date-fns';
import { Inject, Service } from 'typedi';
import { Repository } from 'typeorm';
import { InjectRepository } from 'typeorm-typedi-extensions';

import { Config, ConfigKey } from '../Config';
import { UnregisteredGatewayError } from '../errors';

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

  public async getOrCreateCCAIssuer(): Promise<Certificate> {
    const now = new Date();

    const keyId = await this.config.get(ConfigKey.NODE_CCA_ISSUER_KEY_SERIAL_NUMBER);
    if (keyId) {
      const { certificate: existingCertificate } = await this.fetchNodeKey(
        Buffer.from(keyId, 'hex'),
      );
      const minExpiryDate = addMonths(now, 6);
      if (minExpiryDate <= existingCertificate.expiryDate) {
        return existingCertificate;
      }
    }

    const currentKey = await this.getCurrentKey();
    if (!currentKey) {
      throw new UnregisteredGatewayError(
        'Cannot find a PDA key; private gateway may be unregistered',
      );
    }

    const certificate = await issueGatewayCertificate({
      issuerPrivateKey: currentKey.privateKey,
      subjectPublicKey: await currentKey.certificate.getPublicKey(),
      validityEndDate: addMonths(now, 12),
      validityStartDate: subMinutes(now, 90),
    });
    await this.saveNodeKey(currentKey.privateKey, certificate);
    await this.config.set(
      ConfigKey.NODE_CCA_ISSUER_KEY_SERIAL_NUMBER,
      certificate.getSerialNumberHex(),
    );
    return certificate;
  }
}
