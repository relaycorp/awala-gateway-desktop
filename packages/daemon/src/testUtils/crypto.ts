import { Certificate, IdentityPublicKey, PrivateKey } from '@relaycorp/keystore-db';
import { getPrivateAddressFromIdentityKey, SessionKeyPair } from '@relaycorp/relaynet-core';
import {
  CDACertPath,
  generateCDACertificationPath,
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import { BinaryLike, createHash, Hash } from 'crypto';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';

import { Config, ConfigKey } from '../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../constants';
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
  readonly cdaCertPath: CDACertPath;
};

export function generatePKIFixture(
  cb?: (keyPairSet: NodeKeyPairSet, pdaCertPath: PDACertPath, cdaCertPath: CDACertPath) => void,
): PKIFixtureRetriever {
  let keyPairSet: NodeKeyPairSet;
  let pdaCertPath: PDACertPath;
  let cdaCertPath: CDACertPath;

  beforeAll(async () => {
    keyPairSet = await generateIdentityKeyPairSet();
    pdaCertPath = await generatePDACertificationPath(keyPairSet);
    cdaCertPath = await generateCDACertificationPath(keyPairSet);

    cb?.(keyPairSet, pdaCertPath, cdaCertPath);
  });

  return () => ({
    cdaCertPath,
    keyPairSet,
    pdaCertPath,
  });
}

export interface MockGatewayRegistration {
  readonly undoGatewayRegistration: () => Promise<void>;
  readonly deletePrivateGateway: () => Promise<void>;
  readonly getPublicGatewaySessionPrivateKey: () => CryptoKey;
}

export function mockGatewayRegistration(
  pkiFixtureRetriever: PKIFixtureRetriever,
): MockGatewayRegistration {
  let publicGatewaySessionPrivateKey: CryptoKey;

  beforeEach(async () => {
    const { pdaCertPath, keyPairSet } = pkiFixtureRetriever();

    const privateKeyStore = Container.get(DBPrivateKeyStore);
    const publicKeyStore = Container.get(DBPublicKeyStore);
    const certificateStore = Container.get(DBCertificateStore);
    const config = Container.get(Config);

    const privateGatewayPrivateAddress = await getPrivateAddressFromIdentityKey(
      keyPairSet.privateGateway.publicKey!,
    );
    const publicGatewayPrivateAddress =
      await pdaCertPath.publicGateway.calculateSubjectPrivateAddress();

    await privateKeyStore.saveIdentityKey(keyPairSet.privateGateway.privateKey!!);
    await certificateStore.save(pdaCertPath.privateGateway, privateGatewayPrivateAddress);

    await config.set(ConfigKey.CURRENT_PRIVATE_ADDRESS, privateGatewayPrivateAddress);

    await config.set(ConfigKey.PUBLIC_GATEWAY_PUBLIC_ADDRESS, DEFAULT_PUBLIC_GATEWAY);
    await config.set(ConfigKey.PUBLIC_GATEWAY_PRIVATE_ADDRESS, publicGatewayPrivateAddress);
    await publicKeyStore.saveIdentityKey(keyPairSet.publicGateway.publicKey!);

    const publicGatewaySessionKeyPair = await SessionKeyPair.generate();
    await publicKeyStore.saveSessionKey(
      publicGatewaySessionKeyPair.sessionKey,
      publicGatewayPrivateAddress,
      new Date(),
    );
    publicGatewaySessionPrivateKey = publicGatewaySessionKeyPair.privateKey;
  });

  const undoGatewayRegistration = async () => {
    const configItemRepo = getRepository(ConfigItem);
    await configItemRepo.delete({ key: ConfigKey.PUBLIC_GATEWAY_PRIVATE_ADDRESS });
    await configItemRepo.delete({ key: ConfigKey.PUBLIC_GATEWAY_PUBLIC_ADDRESS });

    const identityPublicKeyRepository = getRepository(IdentityPublicKey);
    await identityPublicKeyRepository.clear();
  };

  const deletePrivateGateway = async () => {
    await undoGatewayRegistration();

    const privateKeyRepository = getRepository(PrivateKey);
    await privateKeyRepository.clear();

    const certificateRepository = getRepository(Certificate);
    await certificateRepository.clear();
  };

  return {
    deletePrivateGateway,
    getPublicGatewaySessionPrivateKey: () => publicGatewaySessionPrivateKey,
    undoGatewayRegistration,
  };
}
