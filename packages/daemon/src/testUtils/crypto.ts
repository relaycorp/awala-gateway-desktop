import { Certificate } from '@relaycorp/relaynet-core';
import {
  generateNodeKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import { BinaryLike, createHash, Hash } from 'crypto';
import { Container } from 'typedi';
import { Config, ConfigKey } from '../Config';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';

function makeSHA256Hash(plaintext: BinaryLike): Hash {
  return createHash('sha256').update(plaintext);
}

export function sha256Hex(plaintext: string): string {
  return makeSHA256Hash(plaintext).digest('hex');
}

export type PKIFixtureRetriever = () => {
  readonly keyPairSet: NodeKeyPairSet;
  readonly certPath: PDACertPath;
};

export function setUpPKIFixture(
  cb: (keyPairSet: NodeKeyPairSet, certPath: PDACertPath) => void,
): PKIFixtureRetriever {
  let keyPairSet: NodeKeyPairSet;
  let certPath: PDACertPath;

  beforeAll(async () => {
    keyPairSet = await generateNodeKeyPairSet();
    certPath = await generatePDACertificationPath(keyPairSet);

    cb(keyPairSet, certPath);
  });

  beforeEach(async () => {
    await mockGatewayRegistration(certPath.privateGateway, keyPairSet.privateGateway.privateKey);
  });

  return () => ({
    certPath,
    keyPairSet,
  });
}

export async function mockGatewayRegistration(
  privateGatewayCertificate: Certificate,
  privateGatewayPrivateKey: CryptoKey,
): Promise<void> {
  const privateKeyStore = Container.get(DBPrivateKeyStore);
  await privateKeyStore.saveNodeKey(privateGatewayPrivateKey, privateGatewayCertificate);

  const config = Container.get(Config);
  await config.set(
    ConfigKey.NODE_KEY_SERIAL_NUMBER,
    privateGatewayCertificate.getSerialNumberHex(),
  );
}
