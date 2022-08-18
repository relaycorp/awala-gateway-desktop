import { Certificate, IdentityPublicKey, IdentityPrivateKey } from '@relaycorp/keystore-db';
import { CertificationPath, getIdFromIdentityKey, SessionKeyPair } from '@relaycorp/relaynet-core';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import { BinaryLike, createHash, Hash } from 'crypto';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';

import { Config, ConfigKey } from '../Config';
import { DEFAULT_INTERNET_GATEWAY } from '../constants';
import { ConfigItem } from '../entity/ConfigItem';
import { DBPublicKeyStore } from '../keystores/DBPublicKeyStore';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { DBCertificateStore } from '../keystores/DBCertificateStore';

function makeSHA256Hash(plaintext: BinaryLike): Hash {
  return createHash('sha256').update(plaintext);
}

export function sha256Hex(plaintext: string): string {
  return makeSHA256Hash(plaintext).digest('hex');
}

export type PKIFixtureRetriever = () => {
  readonly keyPairSet: NodeKeyPairSet;
  readonly pdaCertPath: PDACertPath;
};

export function generatePKIFixture(
  cb?: (keyPairSet: NodeKeyPairSet, pdaCertPath: PDACertPath) => void,
): PKIFixtureRetriever {
  let keyPairSet: NodeKeyPairSet;
  let pdaCertPath: PDACertPath;

  beforeAll(async () => {
    keyPairSet = await generateIdentityKeyPairSet();
    pdaCertPath = await generatePDACertificationPath(keyPairSet);

    cb?.(keyPairSet, pdaCertPath);
  });

  return () => ({
    keyPairSet,
    pdaCertPath,
  });
}

export interface MockGatewayRegistration {
  readonly undoGatewayRegistration: () => Promise<void>;
  readonly deletePrivateGateway: () => Promise<void>;
  readonly getInternetGatewaySessionPrivateKey: () => CryptoKey;
}

export function mockGatewayRegistration(
  pkiFixtureRetriever: PKIFixtureRetriever,
): MockGatewayRegistration {
  let internetGatewaySessionPrivateKey: CryptoKey;

  beforeEach(async () => {
    const { pdaCertPath, keyPairSet } = pkiFixtureRetriever();

    const privateKeyStore = Container.get(DBPrivateKeyStore);
    const publicKeyStore = Container.get(DBPublicKeyStore);
    const certificateStore = Container.get(DBCertificateStore);
    const config = Container.get(Config);

    const privateGatewayPrivateAddress = await getIdFromIdentityKey(
      keyPairSet.privateGateway.publicKey!,
    );
    const internetGatewayId = await pdaCertPath.internetGateway.calculateSubjectId();

    await privateKeyStore.saveIdentityKey(
      privateGatewayPrivateAddress,
      keyPairSet.privateGateway.privateKey!,
    );
    await certificateStore.save(
      new CertificationPath(pdaCertPath.privateGateway, [pdaCertPath.internetGateway]),
      internetGatewayId,
    );

    await config.set(ConfigKey.CURRENT_ID, privateGatewayPrivateAddress);

    await config.set(ConfigKey.INTERNET_GATEWAY_ADDRESS, DEFAULT_INTERNET_GATEWAY);
    await config.set(ConfigKey.INTERNET_GATEWAY_ID, internetGatewayId);
    await publicKeyStore.saveIdentityKey(keyPairSet.internetGateway.publicKey!);

    const internetGatewaySessionKeyPair = await SessionKeyPair.generate();
    await publicKeyStore.saveSessionKey(
      internetGatewaySessionKeyPair.sessionKey,
      internetGatewayId,
      new Date(),
    );
    internetGatewaySessionPrivateKey = internetGatewaySessionKeyPair.privateKey;
  });

  const undoGatewayRegistration = async () => {
    const configItemRepo = getRepository(ConfigItem);
    await configItemRepo.delete({ key: ConfigKey.INTERNET_GATEWAY_ID });
    await configItemRepo.delete({ key: ConfigKey.INTERNET_GATEWAY_ADDRESS });

    const identityPublicKeyRepository = getRepository(IdentityPublicKey);
    await identityPublicKeyRepository.clear();
  };

  const deletePrivateGateway = async () => {
    await undoGatewayRegistration();

    const privateKeyRepository = getRepository(IdentityPrivateKey);
    await privateKeyRepository.clear();

    const certificateRepository = getRepository(Certificate);
    await certificateRepository.clear();
  };

  return {
    deletePrivateGateway,
    getInternetGatewaySessionPrivateKey: () => internetGatewaySessionPrivateKey,
    undoGatewayRegistration,
  };
}
