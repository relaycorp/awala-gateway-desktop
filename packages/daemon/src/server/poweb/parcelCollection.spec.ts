import {
  Certificate,
  CertificateError,
  CMSError,
  DETACHED_SIGNATURE_TYPES,
  generateRSAKeyPair,
  HandshakeChallenge,
  HandshakeResponse,
  issueEndpointCertificate,
  ParcelDelivery,
  Signer,
  StreamingMode,
} from '@relaycorp/relaynet-core';
import { CloseFrame, MockClient } from '@relaycorp/ws-mock';
import bufferToArray from 'buffer-to-arraybuffer';
import uuid from 'uuid-random';

import { ParcelDirection, ParcelStore } from '../../parcelStore';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { arrayBufferFrom } from '../../testUtils/buffer';
import { setUpPKIFixture } from '../../testUtils/crypto';
import { setUpTestDBConnection } from '../../testUtils/db';
import { arrayToAsyncIterable } from '../../testUtils/iterables';
import { mockSpy } from '../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { setImmediateAsync } from '../../testUtils/timing';
import { mockWebsocketStream } from '../../testUtils/websocket';
import { WebSocketCode } from '../websocket';
import makeParcelCollectionServer from './parcelCollection';

setUpTestDBConnection();
useTemporaryAppDirs();

mockWebsocketStream();

const mockLogs = mockLoggerToken();

let trustedEndpointAddress: string;
let trustedEndpointSigner: Signer;
let privateGatewayCertificate: Certificate;
let privateGatewayPrivateKey: CryptoKey;
setUpPKIFixture(async (keyPairSet, certPath) => {
  trustedEndpointAddress = await certPath.privateEndpoint.calculateSubjectPrivateAddress();
  trustedEndpointSigner = new Signer(
    certPath.privateEndpoint,
    keyPairSet.privateEndpoint.privateKey,
  );

  privateGatewayCertificate = certPath.privateGateway;
  privateGatewayPrivateKey = keyPairSet.privateGateway.privateKey;
});

const mockParcelStoreStream = mockSpy(
  jest.spyOn(ParcelStore.prototype, 'streamActiveBoundForEndpoints'),
  () => arrayToAsyncIterable([]),
);
const mockParcelStoreRetrieve = mockSpy(jest.spyOn(ParcelStore.prototype, 'retrieve'), () => null);

describe('Handshake', () => {
  test('Challenge should be sent as soon as client connects', async () => {
    const client = new MockParcelCollectionClient();

    await client.connect();

    const handshakeRaw = await client.receive();
    HandshakeChallenge.deserialize(bufferToArray(handshakeRaw as Buffer));
    expect(mockLogs).toContainEqual(partialPinoLog('debug', 'Sending handshake challenge'));
  });

  test('Client-initiated closure before response should be handled gracefully', async () => {
    const client = new MockParcelCollectionClient();
    await client.connect();
    await client.receive(); // Discard challenge

    client.close(WebSocketCode.NORMAL);

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.NORMAL,
    });
    expect(mockLogs).toContainEqual(
      partialPinoLog('debug', 'Client closed the connection before completing the handshake'),
    );
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
    expect(mockParcelStoreStream).not.toBeCalled();
  });

  test('Handshake should complete successfully if all signatures are valid', async () => {
    const endpoint2KeyPair = await generateRSAKeyPair();
    const endpoint2Certificate = await issueEndpointCertificate({
      issuerCertificate: privateGatewayCertificate,
      issuerPrivateKey: privateGatewayPrivateKey,
      subjectPublicKey: endpoint2KeyPair.publicKey,
      validityEndDate: privateGatewayCertificate.expiryDate,
    });
    const trustedEndpoint2Signer = new Signer(endpoint2Certificate, endpoint2KeyPair.privateKey);
    const client = new MockParcelCollectionClient();
    await client.connect();

    await client.doHandshake([trustedEndpointSigner, trustedEndpoint2Signer]);

    const endpointAddresses: readonly string[] = [
      trustedEndpointAddress,
      await endpoint2Certificate.calculateSubjectPrivateAddress(),
    ];
    expect(mockLogs).toContainEqual(
      partialPinoLog('debug', 'Handshake completed successfully', {
        endpointAddresses,
      }),
    );
    expect(mockParcelStoreStream).toBeCalledWith(endpointAddresses, expect.anything());
  });
});

test('Active parcels should be sent to client', async () => {
  const parcelKey = 'parcel-key';
  const parcelSerialized = Buffer.from('the parcel');
  setParcelsInStore({ key: parcelKey, serialization: parcelSerialized });
  const client = new MockParcelCollectionClient();
  await client.connect();
  await client.doHandshake();

  const parcelDelivery = await client.receiveParcelDelivery();

  expect(Buffer.from(parcelDelivery.parcelSerialized).equals(parcelSerialized)).toBeTrue();
  expect(uuid.test(parcelDelivery.deliveryId));
  expect(mockLogs).toContainEqual(partialPinoLog('debug', 'Sending parcel', { parcelKey }));
  expect(mockParcelStoreStream).toBeCalledWith([trustedEndpointAddress], expect.anything());
  expect(mockParcelStoreRetrieve).toBeCalledWith(parcelKey, ParcelDirection.INTERNET_TO_ENDPOINT);
});

test('Recently-deleted parcels should be gracefully skipped', async () => {
  const missingParcelKey = 'missing parcel';
  const parcelSerialized = Buffer.from('the parcel');
  setParcelsInStore({ key: missingParcelKey }, { key: 'parcel2', serialization: parcelSerialized });
  const client = new MockParcelCollectionClient();
  await client.connect();
  await client.doHandshake();

  const parcelDelivery = await client.receiveParcelDelivery();

  expect(Buffer.from(parcelDelivery.parcelSerialized).equals(parcelSerialized)).toBeTrue();
  expect(mockLogs).toContainEqual(
    partialPinoLog('debug', 'Skipping missing parcel', { parcelKey: missingParcelKey }),
  );
});

describe('Keep alive', () => {
  test('Connection should be closed if Keep-Alive is off and there are no parcels', async () => {
    const client = new MockParcelCollectionClient(StreamingMode.CLOSE_UPON_COMPLETION);
    await client.connect();
    await client.doHandshake();

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.NORMAL,
    });

    expect(mockParcelStoreStream).toBeCalledWith(expect.anything(), false);
  });

  test('Connection should be closed upon completion if Keep-Alive is off', async () => {
    setParcelsInStore({ key: 'parcel key', serialization: Buffer.from('the parcel') });
    const client = new MockParcelCollectionClient(StreamingMode.CLOSE_UPON_COMPLETION);
    await client.connect();
    await client.doHandshake();
    await client.receive(); // Ignore parcel collection

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.NORMAL,
    });

    expect(mockParcelStoreStream).toBeCalledWith(expect.anything(), false);
  });

  test('Connection should be kept alive indefinitely if Keep-Alive is on', async () => {
    const client = new MockParcelCollectionClient(StreamingMode.KEEP_ALIVE);
    await client.connect();
    await client.doHandshake();

    expect(mockParcelStoreStream).toBeCalledWith(expect.anything(), true);
  });

  test('Connection should be kept alive indefinitely if Keep-Alive value is invalid', async () => {
    const client = new MockParcelCollectionClient('invalid mode' as any);
    await client.connect();
    await client.doHandshake();

    expect(mockParcelStoreStream).toBeCalledWith(expect.anything(), true);
  });
});

describe('Acknowledgements', () => {
  test('Server should send parcel to client even if a previous one is unacknowledged', async () => {
    const parcel1Key = 'parcel1 key';
    const parcel2Key = 'parcel2 key';
    const parcel1Serialized = Buffer.from('parcel1');
    const parcel2Serialized = Buffer.from('parcel2');
    setParcelsInStore(
      { key: parcel1Key, serialization: parcel1Serialized },
      { key: parcel2Key, serialization: parcel2Serialized },
    );
    const client = new MockParcelCollectionClient();
    await client.connect();
    await client.doHandshake();

    const parcel1Delivery = await client.receiveParcelDelivery();
    expect(Buffer.from(parcel1Delivery.parcelSerialized).equals(parcel1Serialized)).toBeTrue();

    const parcel2Delivery = await client.receiveParcelDelivery();
    expect(Buffer.from(parcel2Delivery.parcelSerialized).equals(parcel2Serialized)).toBeTrue();
  });

  test.todo('Parcel should be acknowledged in store when client acknowledges it');

  test.todo('Parcel should not be deleted if client never acknowledges it');

  test.todo('Connection should be closed with an error if client sends unknown ACK');

  test.todo('Connection should be closed with an error if client sends a binary ACK');

  test.todo('Connection should be closed when all parcels have been delivered and ACKed');
});

test.todo('Client-initiated WebSocket connection closure should be handled gracefully');

test.todo('Abrupt TCP connection closure should be handled gracefully');

class MockParcelCollectionClient extends MockClient {
  constructor(streamingMode: StreamingMode = StreamingMode.CLOSE_UPON_COMPLETION) {
    super(makeParcelCollectionServer(), {
      'x-relaynet-streaming-mode': streamingMode.toString(),
    });
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

    await setImmediateAsync();
  }

  public async receiveParcelDelivery(): Promise<ParcelDelivery> {
    const parcelDeliveryRaw = bufferToArray((await this.receive()) as Buffer);
    return ParcelDelivery.deserialize(parcelDeliveryRaw);
  }
}

interface StoredParcel {
  readonly key: string;
  readonly serialization?: Buffer;
}

function setParcelsInStore(...storedParcels: readonly StoredParcel[]): void {
  const keys = storedParcels.map((p) => p.key);
  mockParcelStoreStream.mockReturnValueOnce(arrayToAsyncIterable(keys));

  for (const { serialization } of storedParcels) {
    mockParcelStoreRetrieve.mockResolvedValueOnce(serialization ?? null);
  }
}
