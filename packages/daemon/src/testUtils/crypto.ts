import {
  generateNodeKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import { BinaryLike, createHash, Hash } from 'crypto';

import { DEFAULT_PUBLIC_GATEWAY } from '../constants';
import { DBPrivateKeyStore } from '../keystores/DBPrivateKeyStore';
import { GatewayRegistrar } from '../sync/publicGateway/GatewayRegistrar';
import { mockSpy } from './jest';

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

export function generatePKIFixture(
  cb: (keyPairSet: NodeKeyPairSet, certPath: PDACertPath) => void,
): PKIFixtureRetriever {
  let keyPairSet: NodeKeyPairSet;
  let certPath: PDACertPath;

  beforeAll(async () => {
    keyPairSet = await generateNodeKeyPairSet();
    certPath = await generatePDACertificationPath(keyPairSet);

    cb(keyPairSet, certPath);
  });

  return () => ({
    certPath,
    keyPairSet,
  });
}

export function mockGatewayRegistration(pkiFixtureRetriever: PKIFixtureRetriever): () => void {
  const mockGetPublicGateway = mockSpy(
    jest.spyOn(GatewayRegistrar.prototype, 'getPublicGateway'),
    () => {
      const { certPath } = pkiFixtureRetriever();
      return {
        identityCertificate: certPath.publicGateway,
        publicAddress: DEFAULT_PUBLIC_GATEWAY,
      };
    },
  );
  const mockIsRegistered = mockSpy(
    jest.spyOn(GatewayRegistrar.prototype, 'isRegistered'),
    () => true,
  );

  const mockGetCurrentKey = mockSpy(
    jest.spyOn(DBPrivateKeyStore.prototype, 'getCurrentKey'),
    () => {
      const { certPath, keyPairSet } = pkiFixtureRetriever();
      return {
        certificate: certPath.privateGateway,
        privateKey: keyPairSet.privateGateway.privateKey,
      };
    },
  );
  const mockFetchNodeCertificates = mockSpy(
    jest.spyOn(DBPrivateKeyStore.prototype, 'fetchNodeCertificates'),
    () => {
      const { certPath } = pkiFixtureRetriever();
      return [certPath.privateGateway];
    },
  );

  return () => {
    mockGetPublicGateway.mockResolvedValue(null);
    mockIsRegistered.mockResolvedValue(false);
    mockGetCurrentKey.mockResolvedValue(null);
    mockFetchNodeCertificates.mockResolvedValue([]);
  };
}
