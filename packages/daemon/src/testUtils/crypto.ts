import { PrivateKey } from '@relaycorp/keystore-db';
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
import { FileStore } from '../fileStore';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { PUBLIC_GATEWAY_ID_CERTIFICATE_OBJECT_KEY } from '../sync/publicGateway/GatewayRegistrar';

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
  cb: (keyPairSet: NodeKeyPairSet, pdaCertPath: PDACertPath, cdaCertPath: CDACertPath) => void,
): PKIFixtureRetriever {
  let keyPairSet: NodeKeyPairSet;
  let pdaCertPath: PDACertPath;
  let cdaCertPath: CDACertPath;

  beforeAll(async () => {
    keyPairSet = await generateIdentityKeyPairSet();
    pdaCertPath = await generatePDACertificationPath(keyPairSet);
    cdaCertPath = await generateCDACertificationPath(keyPairSet);

    cb(keyPairSet, pdaCertPath, cdaCertPath);
  });

  return () => ({
    cdaCertPath,
    keyPairSet,
    pdaCertPath,
  });
}

export function mockGatewayRegistration(
  pkiFixtureRetriever: PKIFixtureRetriever,
): () => Promise<void> {
  beforeEach(async () => {
    const { cdaCertPath, pdaCertPath, keyPairSet } = pkiFixtureRetriever();

    const privateKeyStore = Container.get(DBPrivateKeyStore);
    const config = Container.get(Config);
    const fileStore = Container.get(FileStore);

    await privateKeyStore.saveNodeKey(
      keyPairSet.privateGateway.privateKey,
      pdaCertPath.privateGateway,
    );
    await config.set(
      ConfigKey.NODE_KEY_SERIAL_NUMBER,
      pdaCertPath.privateGateway.getSerialNumberHex(),
    );

    await config.set(ConfigKey.PUBLIC_GATEWAY_ADDRESS, DEFAULT_PUBLIC_GATEWAY);
    await fileStore.putObject(
      Buffer.from(pdaCertPath.publicGateway.serialize()),
      PUBLIC_GATEWAY_ID_CERTIFICATE_OBJECT_KEY,
    );

    await privateKeyStore.saveNodeKey(
      keyPairSet.privateGateway.privateKey,
      cdaCertPath.privateGateway,
    );
    await config.set(
      ConfigKey.NODE_CCA_ISSUER_KEY_SERIAL_NUMBER,
      cdaCertPath.privateGateway.getSerialNumberHex(),
    );
  });

  return async () => {
    const configItemRepo = getRepository(ConfigItem);
    await configItemRepo.clear();

    const privateKeyRepo = getRepository(PrivateKey);
    await privateKeyRepo.clear();

    const fileStore = Container.get(FileStore);
    await fileStore.deleteObject(PUBLIC_GATEWAY_ID_CERTIFICATE_OBJECT_KEY);
  };
}
