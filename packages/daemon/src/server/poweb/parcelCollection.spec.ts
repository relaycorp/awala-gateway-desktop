import {
  Certificate,
  CertificateError,
  CMSError,
  DETACHED_SIGNATURE_TYPES,
  generateRSAKeyPair,
  HandshakeChallenge,
  HandshakeResponse,
  issueEndpointCertificate,
  Signer,
} from '@relaycorp/relaynet-core';
import { CloseFrame, MockClient } from '@relaycorp/ws-mock';
import bufferToArray from 'buffer-to-arraybuffer';

import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { arrayBufferFrom } from '../../testUtils/buffer';
import { setUpPKIFixture } from '../../testUtils/crypto';
import { setUpTestDBConnection } from '../../testUtils/db';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { mockWebsocketStream } from '../../testUtils/websocket';
import { WebSocketCode } from '../websocket';
import makeParcelCollectionServer from './parcelCollection';

setUpTestDBConnection();
useTemporaryAppDirs();

mockWebsocketStream();

const mockLogs = mockLoggerToken();

let trustedEndpointSigner: Signer;
let privateGatewayCertificate: Certificate;
let privateGatewayPrivateKey: CryptoKey;
setUpPKIFixture((keyPairSet, certPath) => {
  trustedEndpointSigner = new Signer(
    certPath.privateEndpoint,
    keyPairSet.privateEndpoint.privateKey,
  );

  privateGatewayCertificate = certPath.privateGateway;
  privateGatewayPrivateKey = keyPairSet.privateGateway.privateKey;
});

describe('Handshake', () => {
  test('Challenge should be sent as soon as client connects', async () => {
    const client = new MockParcelCollectionClient();

    await client.connect();

    const handshakeRaw = await client.receive();
    HandshakeChallenge.deserialize(bufferToArray(handshakeRaw as Buffer));
    expect(mockLogs).toContainEqual(partialPinoLog('debug', 'Sending handshake challenge'));
  });

  test('Handshake should fail if response is malformed', async () => {
    const client = new MockParcelCollectionClient();
    await client.connect();
    await client.receive(); // Discard challenge

    await client.send(Buffer.from('malformed'));

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.CANNOT_ACCEPT,
      reason: 'Malformed handshake response',
    });
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Refusing malformed handshake response'),
    );
  });

  test('Handshake should fail if response is a text frame', async () => {
    const client = new MockParcelCollectionClient();
    await client.connect();
    await client.receive(); // Discard challenge

    await client.send('this should have been a buffer, not a string');

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.CANNOT_ACCEPT,
      reason: 'Malformed handshake response',
    });
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Refusing malformed handshake response'),
    );
  });

  test('Handshake should fail if response contains zero signatures', async () => {
    const client = new MockParcelCollectionClient();
    await client.connect();

    await client.doHandshake([]);

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.CANNOT_ACCEPT,
      reason: 'Handshake response does not include any signatures',
    });
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Refusing handshake response with zero signatures'),
    );
  });

  test('Handshake should fail if a response signature is invalid', async () => {
    const client = new MockParcelCollectionClient();
    await client.connect();

    const challenge = HandshakeChallenge.deserialize(
      bufferToArray((await client.receive()) as Buffer),
    );
    const validSignature = await trustedEndpointSigner.sign(
      challenge.nonce,
      DETACHED_SIGNATURE_TYPES.NONCE,
    );
    const handshakeResponse = new HandshakeResponse([validSignature, arrayBufferFrom('malformed')]);
    await client.send(handshakeResponse.serialize());

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.CANNOT_ACCEPT,
      reason: 'Handshake response includes malformed/invalid signature(s)',
    });
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Refusing handshake response with malformed/invalid signatures', {
        err: expect.objectContaining({ type: CMSError.name }),
      }),
    );
  });

  test('Handshake should fail if a signer of response nonce is not trusted', async () => {
    const untrustedEndpointKeyPair = await generateRSAKeyPair();
    const untrustedEndpointCertificate = await issueEndpointCertificate({
      issuerPrivateKey: untrustedEndpointKeyPair.privateKey,
      subjectPublicKey: untrustedEndpointKeyPair.publicKey,
      validityEndDate: privateGatewayCertificate.expiryDate,
    });
    const untrustedEndpointSigner = new Signer(
      untrustedEndpointCertificate,
      untrustedEndpointKeyPair.privateKey,
    );
    const client = new MockParcelCollectionClient();
    await client.connect();

    await client.doHandshake([trustedEndpointSigner, untrustedEndpointSigner]);

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.CANNOT_ACCEPT,
      reason: 'Handshake response includes malformed/invalid signature(s)',
    });
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Refusing handshake response with malformed/invalid signatures', {
        err: expect.objectContaining({ type: CertificateError.name }),
      }),
    );
  });

  test('Handshake should complete successfully if all signatures are valid', async () => {
    const endpoint2KeyPair = await generateRSAKeyPair();
    const endpoint2Certificate = await issueEndpointCertificate({
      issuerCertificate: privateGatewayCertificate,
      issuerPrivateKey: privateGatewayPrivateKey,
      subjectPublicKey: endpoint2KeyPair.publicKey,
      validityEndDate: privateGatewayCertificate.expiryDate,
    });
    const endpoint2Signer = new Signer(endpoint2Certificate, endpoint2KeyPair.privateKey);
    const client = new MockParcelCollectionClient();
    await client.connect();

    await client.doHandshake([trustedEndpointSigner, endpoint2Signer]);

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.NORMAL,
    });
    expect(mockLogs).toContainEqual(
      partialPinoLog('debug', 'Handshake completed successfully', {
        endpointAddresses: [
          await trustedEndpointSigner.certificate.calculateSubjectPrivateAddress(),
          await endpoint2Certificate.calculateSubjectPrivateAddress(),
        ],
      }),
    );
  });
});

class MockParcelCollectionClient extends MockClient {
  constructor() {
    super(makeParcelCollectionServer());
  }

  public async doHandshake(signers?: readonly Signer[]): Promise<void> {
    const finalSigners = signers ?? [trustedEndpointSigner];
    const challenge = HandshakeChallenge.deserialize(
      bufferToArray((await this.receive()) as Buffer),
    );
    const signatures = await Promise.all(
      finalSigners.map((s) => s.sign(challenge.nonce, DETACHED_SIGNATURE_TYPES.NONCE)),
    );
    const handshakeResponse = new HandshakeResponse(signatures);
    await this.send(handshakeResponse.serialize());
  }
}
