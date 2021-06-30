import {
  CDACertPath,
  generateCDACertificationPath,
  generateNodeKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import { BinaryLike, createHash, Hash } from 'crypto';

import { DEFAULT_PUBLIC_GATEWAY } from '../constants';
import { UnregisteredGatewayError } from '../errors';
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
    keyPairSet = await generateNodeKeyPairSet();
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

export function mockGatewayRegistration(pkiFixtureRetriever: PKIFixtureRetriever): () => void {
  const mockGetPublicGateway = mockSpy(
    jest.spyOn(GatewayRegistrar.prototype, 'getPublicGateway'),
    () => {
      const { pdaCertPath } = pkiFixtureRetriever();
      return {
        identityCertificate: pdaCertPath.publicGateway,
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
      const { pdaCertPath, keyPairSet } = pkiFixtureRetriever();
      return {
        certificate: pdaCertPath.privateGateway,
        privateKey: keyPairSet.privateGateway.privateKey,
      };
    },
  );
  const mockGetOrCreateCCAIssuer = mockSpy(
    jest.spyOn(DBPrivateKeyStore.prototype, 'getOrCreateCCAIssuer'),
    () => {
      const { cdaCertPath } = pkiFixtureRetriever();
      return cdaCertPath.privateGateway;
    },
  );
  const mockFetchNodeCertificates = mockSpy(
    jest.spyOn(DBPrivateKeyStore.prototype, 'fetchNodeCertificates'),
    () => {
      const { pdaCertPath } = pkiFixtureRetriever();
      return [pdaCertPath.privateGateway];
    },
  );

  return () => {
    mockGetPublicGateway.mockResolvedValue(null);
    mockIsRegistered.mockResolvedValue(false);
    mockGetCurrentKey.mockResolvedValue(null);
    mockFetchNodeCertificates.mockResolvedValue([]);
    mockGetOrCreateCCAIssuer.mockRejectedValue(
      new UnregisteredGatewayError('Mocking gateway deregistration'),
    );
  };
}
