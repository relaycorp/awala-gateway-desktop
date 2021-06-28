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
import { Data } from 'ws';

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
import { sleepSeconds } from '../../utils/timing';
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
const mockParcelStoreDelete = mockSpy(jest.spyOn(ParcelStore.prototype, 'delete'), () => undefined);

describe('Handshake', () => {
  test('Challenge should be sent as soon as client connects', async () => {
    const client = new MockParcelCollectionClient();

    await client.connect();

    const handshakeRaw = await client.receive();
    HandshakeChallenge.deserialize(bufferToArray(handshakeRaw as Buffer));
    expect(mockLogs).toContainEqual(partialPinoLog('debug', 'Sending handshake challenge'));
  });

  test('Handshake should be aborted if client closes connection before responding', async () => {
    const client = new MockParcelCollectionClient();
    await client.connect();
    await client.receive(); // Discard challenge

    client.close();

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.NORMAL,
      reason: 'Handshake aborted',
    });
    expect(mockLogs).toContainEqual(partialPinoLog('debug', 'Client aborted handshake'));
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
    expect(mockLogs).toContainEqual(
      partialPinoLog('debug', 'All parcels were acknowledged shortly after the last one was sent', {
        endpointAddresses: [trustedEndpointAddress],
      }),
    );
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
    expect(Buffer.from(parcel1Delivery.parcelSerialized)).toEqual(parcel1Serialized);

    const parcel2Delivery = await client.receiveParcelDelivery();
    expect(Buffer.from(parcel2Delivery.parcelSerialized)).toEqual(parcel2Serialized);
  });

  test('Parcel should be deleted when client acknowledges it', async () => {
    const parcelKey = 'parcel1 key';
    setParcelsInStore({ key: parcelKey, serialization: Buffer.from('parcel1') });
    const client = new MockParcelCollectionClient();
    await client.connect();
    await client.doHandshake();
    const parcelDelivery = await client.receiveParcelDelivery();

    await client.acknowledgeDelivery(parcelDelivery.deliveryId);

    expect(mockParcelStoreDelete).toBeCalledWith(parcelKey, ParcelDirection.INTERNET_TO_ENDPOINT);
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Deleting acknowledged parcel', {
        endpointAddresses: [trustedEndpointAddress],
        parcelKey,
      }),
    );
  });

  test('Parcel should not be deleted if client never acknowledges it', async () => {
    setParcelsInStore({ key: 'parcel1 key', serialization: Buffer.from('parcel1') });
    const client = new MockParcelCollectionClient();
    await client.connect();
    await client.doHandshake();
    await client.receiveParcelDelivery();

    await sleepSeconds(0.5);

    expect(mockParcelStoreDelete).not.toBeCalled();
  });

  test('Connection should be closed with an error if client sends unknown ACK', async () => {
    setParcelsInStore({ key: 'parcel1 key', serialization: Buffer.from('parcel1') });
    const client = new MockParcelCollectionClient();
    await client.connect();
    await client.doHandshake();
    await client.receiveParcelDelivery();

    await client.acknowledgeDelivery('invalid delivery id');

    await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
      code: WebSocketCode.CANNOT_ACCEPT,
      reason: 'Unknown delivery id sent as acknowledgement',
    });
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Closing connection due to unknown acknowledgement', {
        endpointAddresses: [trustedEndpointAddress],
      }),
    );
  });

  test.each([StreamingMode.KEEP_ALIVE, StreamingMode.CLOSE_UPON_COMPLETION])(
    'Connection with %s should be closed when all parcels have been ACKed',
    async (mode) => {
      const parcel1Key = 'parcel1 key';
      const parcel2Key = 'parcel2 key';
      const parcel1Serialized = Buffer.from('parcel1');
      const parcel2Serialized = Buffer.from('parcel2');
      setParcelsInStore(
        { key: parcel1Key, serialization: parcel1Serialized },
        { key: parcel2Key, serialization: parcel2Serialized },
      );
      const client = new MockParcelCollectionClient(mode);
      await client.connect();
      await client.doHandshake();

      const parcel1Delivery = await client.receiveParcelDelivery();
      const parcel2Delivery = await client.receiveParcelDelivery();
      // ACK out of order:
      await client.acknowledgeDelivery(parcel2Delivery.deliveryId);
      await client.acknowledgeDelivery(parcel1Delivery.deliveryId);

      await expect(client.waitForPeerClosure()).resolves.toEqual<CloseFrame>({
        code: WebSocketCode.NORMAL,
      });
      expect(mockLogs).toContainEqual(
        partialPinoLog('debug', 'All parcels have been collected and acknowledged', {
          endpointAddresses: [trustedEndpointAddress],
        }),
      );
    },
  );
});

test('Connection closure should be logged', async () => {
  setParcelsInStore({ key: 'parcel1 key', serialization: Buffer.from('parcel1') });
  const client = new MockParcelCollectionClient();
  await client.connect();
  await client.doHandshake();
  const closureReason = 'I have to run';

  client.close(WebSocketCode.NORMAL, closureReason);

  await setImmediateAsync();
  expect(mockLogs).toContainEqual(
    partialPinoLog('debug', 'Closing connection', {
      code: WebSocketCode.NORMAL,
      reason: closureReason,
    }),
  );
});

test('Abrupt connection closure should be logged', async () => {
  const client = new MockParcelCollectionClient();
  await client.connect();
  await client.doHandshake();
  const error = new Error('my bad');

  client.abort(error);

  await setImmediateAsync();
  expect(mockLogs).toContainEqual(
    partialPinoLog('error', 'Unexpected error', {
      err: expect.objectContaining({ message: error.message }),
    }),
  );
});

class MockParcelCollectionClient extends MockClient {
  constructor(streamingMode: StreamingMode = StreamingMode.CLOSE_UPON_COMPLETION) {
    super(makeParcelCollectionServer(), {
      'x-relaynet-streaming-mode': streamingMode.toString(),
    });
  }

  public async send(message: Data): Promise<void> {
    await super.send(message);
    await setImmediateAsync();
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

  public async receiveParcelDelivery(): Promise<ParcelDelivery> {
    const parcelDeliveryRaw = bufferToArray((await this.receive()) as Buffer);
    return ParcelDelivery.deserialize(parcelDeliveryRaw);
  }

  public async acknowledgeDelivery(deliveryId: string): Promise<void> {
    await this.send(Buffer.from(deliveryId));
  }
}

interface StoredParcel {
  readonly key: string;
  readonly serialization?: Buffer;
}

function setParcelsInStore(...storedParcels: readonly StoredParcel[]): void {
  const keys = storedParcels.map((p) => p.key);
  mockParcelStoreStream.mockReturnValue(arrayToAsyncIterable(keys));

  mockParcelStoreRetrieve.mockReset();
  for (const { serialization } of storedParcels) {
    mockParcelStoreRetrieve.mockResolvedValueOnce(serialization ?? null);
  }
}
