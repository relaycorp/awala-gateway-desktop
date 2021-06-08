import { Certificate } from '@relaycorp/relaynet-core';
import {
  generateNodeKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import { BinaryLike, createHash, Hash } from 'crypto';
import { Container } from 'typedi';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';

function makeSHA256Hash(plaintext: BinaryLike): Hash {
  return createHash('sha256').update(plaintext);
}

export function sha256Hex(plaintext: string): string {
  return makeSHA256Hash(plaintext).digest('hex');
}

export function setUpPKIFixture(
  cb: (keyPairSet: NodeKeyPairSet, certPath: PDACertPath) => void,
): void {
  let gatewayPrivateKey: CryptoKey;
  let gatewayCertificate: Certificate;

  beforeAll(async () => {
    const keyPairSet = await generateNodeKeyPairSet();
    const certPath = await generatePDACertificationPath(keyPairSet);

    gatewayPrivateKey = keyPairSet.privateGateway.privateKey;
    gatewayCertificate = certPath.privateGateway;

    cb(keyPairSet, certPath);
  });

  beforeEach(async () => {
    const privateKeyStore = Container.get(DBPrivateKeyStore);
    await privateKeyStore.saveNodeKey(gatewayPrivateKey, gatewayCertificate);
  });
}
