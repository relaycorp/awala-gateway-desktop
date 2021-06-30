import { CogRPCClient } from '@relaycorp/cogrpc';
import {
  Cargo,
  CargoCollectionAuthorization,
  CargoDeliveryRequest,
  CargoMessageSet,
  Certificate,
  CMSError,
  derSerializePublicKey,
  InvalidMessageError,
  ParcelCollectionAck,
  RAMFSyntaxError,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { addDays, addSeconds, subMinutes } from 'date-fns';
import { v4 } from 'default-gateway';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';
import uuid from 'uuid-random';

import { CourierSyncExitCode, CourierSyncStage } from '.';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { ParcelCollection } from '../../entity/ParcelCollection';
import { FileStore } from '../../fileStore';
import { ParcelStore } from '../../parcelStore';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { generatePKIFixture, mockGatewayRegistration } from '../../testUtils/crypto';
import { setUpTestDBConnection } from '../../testUtils/db';
import { arrayToAsyncIterable, asyncIterableToArray } from '../../testUtils/iterables';
import { getMockInstance, mockSpy } from '../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { GeneratedCargo, GeneratedParcel, makeCargo, makeParcel } from '../../testUtils/ramf';
import { makeStubPassThrough, recordReadableStreamMessages } from '../../testUtils/stream';
import { MessageDirection } from '../../utils/MessageDirection';
import { sleepSeconds } from '../../utils/timing';
import { CourierSyncStageNotification, ParcelCollectionNotification } from './messaging';
import runCourierSync from './subprocess';

jest.mock('default-gateway', () => ({ v4: jest.fn() }));
const mockGatewayIPAddress = '192.168.0.12';
beforeEach(() => {
  getMockInstance(v4).mockRestore();
  getMockInstance(v4).mockResolvedValue({ gateway: mockGatewayIPAddress });
});

jest.mock('@relaycorp/cogrpc', () => ({ CogRPCClient: { init: jest.fn() } }));
jest.mock('../../utils/timing');

setUpTestDBConnection();
useTemporaryAppDirs();
const mockLogs = mockLoggerToken();

let privateGatewayPDACertificate: Certificate;
let privateGatewayCDACertificate: Certificate;
let publicGatewayPrivateKey: CryptoKey;
let publicGatewayPDACertificate: Certificate;
const pkiFixtureRetriever = generatePKIFixture(async (keyPairSet, pdaCertPath, cdaCertPath) => {
  privateGatewayPDACertificate = pdaCertPath.privateGateway;
  privateGatewayCDACertificate = cdaCertPath.privateGateway;

  publicGatewayPrivateKey = keyPairSet.publicGateway.privateKey;
  publicGatewayPDACertificate = pdaCertPath.publicGateway;
});
const undoGatewayRegistration = mockGatewayRegistration(pkiFixtureRetriever);

const mockCollectCargo = mockSpy(jest.fn(), () => arrayToAsyncIterable([]));
const mockDeliverCargo = mockSpy(jest.fn(), () => arrayToAsyncIterable([]));
const mockCogRPCClose = mockSpy(jest.fn());
beforeEach(() => {
  getMockInstance(CogRPCClient.init).mockRestore();
  getMockInstance(CogRPCClient.init).mockReturnValue({
    close: mockCogRPCClose,
    collectCargo: mockCollectCargo,
    deliverCargo: mockDeliverCargo,
  });
});

let parcelStore: ParcelStore;
beforeEach(() => {
  parcelStore = Container.get(ParcelStore);
});

const getParentStream = makeStubPassThrough();

test('Subprocess should error out if private gateway is unregistered', async () => {
  await undoGatewayRegistration();

  await expect(runCourierSync(getParentStream())).resolves.toEqual(
    CourierSyncExitCode.UNREGISTERED_GATEWAY,
  );

  expect(mockLogs).toContainEqual(partialPinoLog('fatal', 'Private gateway is unregistered'));
});

test('Subprocess should error out if default gateway could not be found', async () => {
  const gatewayError = new Error('Cannot find gateway IP address');
  getMockInstance(v4).mockRejectedValue(gatewayError);

  await expect(runCourierSync(getParentStream())).resolves.toEqual(CourierSyncExitCode.FAILED_SYNC);

  expect(mockLogs).toContainEqual(
    partialPinoLog('fatal', 'System default gateway could not be found', {
      err: expect.objectContaining({ message: gatewayError.message }),
    }),
  );
});

test('Client should connect to port 21473 on the default gateway', async () => {
  await runCourierSync(getParentStream());

  expect(CogRPCClient.init).toBeCalledWith(`https://${mockGatewayIPAddress}:21473`);
});

test('Subprocess should error out if the CogRPC client cannot be initialised', async () => {
  const gatewayError = new Error('TLS connection failure');
  getMockInstance(CogRPCClient.init).mockRejectedValue(gatewayError);

  await expect(runCourierSync(getParentStream())).resolves.toEqual(CourierSyncExitCode.FAILED_SYNC);

  expect(mockLogs).toContainEqual(
    partialPinoLog('fatal', 'Sync failed', {
      err: expect.objectContaining({ message: gatewayError.message }),
    }),
  );
});

describe('Cargo collection', () => {
  test('Parent should be notified about COLLECTION stage at the start', async () => {
    const parentStream = getParentStream();
    const getParentStreamMessages = recordReadableStreamMessages(parentStream);

    await runCourierSync(parentStream);

    const [firstStage] = getParentStreamMessages();
    expect(firstStage).toEqual<CourierSyncStageNotification>({
      stage: CourierSyncStage.COLLECTION,
      type: 'stage',
    });
  });

  test('CogRPC client should be closed when collection fails', async () => {
    const error = new Error('nope.jpeg');
    mockCollectCargo.mockImplementation(async function* (): AsyncIterable<any> {
      throw error;
    });

    await expect(runCourierSync(getParentStream())).resolves.toEqual(
      CourierSyncExitCode.FAILED_SYNC,
    );

    expect(mockCogRPCClose).toBeCalledWith();
    expect(mockLogs).toContainEqual(
      partialPinoLog('fatal', 'Sync failed', {
        err: expect.objectContaining({ message: error.message }),
      }),
    );
  });

  describe('Cargo Collection Authorization', () => {
    test('Recipient should be public gateway', async () => {
      await runCourierSync(getParentStream());

      const cca = await retrieveCCA();
      expect(cca.recipientAddress).toEqual(`https://${DEFAULT_PUBLIC_GATEWAY}`);
    });

    test('Creation date should be 90 minutes in the past to tolerate clock drift', async () => {
      await runCourierSync(getParentStream());

      const cca = await retrieveCCA();
      expect(cca.creationDate).toBeBefore(subMinutes(new Date(), 90));
      expect(cca.creationDate).toBeAfter(subMinutes(new Date(), 92));
    });

    test('Expiry date should be 14 days in the future', async () => {
      await runCourierSync(getParentStream());

      const cca = await retrieveCCA();
      expect(cca.expiryDate).toBeAfter(addDays(new Date(), 13));
      expect(cca.expiryDate).toBeBefore(addDays(new Date(), 14));
    });

    test('Sender should be PDA certificate of private gateway', async () => {
      await runCourierSync(getParentStream());

      const cca = await retrieveCCA();

      expect(cca.senderCertificate.isEqual(privateGatewayPDACertificate)).toBeTrue();
    });

    test('Sender certificate chain should be empty', async () => {
      await runCourierSync(getParentStream());

      const cca = await retrieveCCA();
      expect(cca.senderCaCertificateChain).toEqual([]);
    });

    describe('Cargo Delivery Authorization in Cargo Collection Request', () => {
      test('Public key should be that of the public gateway', async () => {
        await runCourierSync(getParentStream());

        const cca = await retrieveCCA();
        const cargoDeliveryAuthorization = await retrieveCDA(cca);
        expect(cargoDeliveryAuthorization.isEqual(publicGatewayPDACertificate)).toBeFalse();
        await expect(
          derSerializePublicKey(await cargoDeliveryAuthorization.getPublicKey()),
        ).resolves.toEqual(
          await derSerializePublicKey(await publicGatewayPDACertificate.getPublicKey()),
        );
      });

      test('Certificate should be valid for 14 days', async () => {
        await runCourierSync(getParentStream());

        const cca = await retrieveCCA();
        const cargoDeliveryAuthorization = await retrieveCDA(cca);
        expect(cargoDeliveryAuthorization.expiryDate).toBeAfter(addDays(new Date(), 13));
        expect(cargoDeliveryAuthorization.expiryDate).toBeBefore(addDays(new Date(), 14));
      });

      test('Issuer should be private gateway', async () => {
        await runCourierSync(getParentStream());

        const cca = await retrieveCCA();
        const cargoDeliveryAuthorization = await retrieveCDA(cca);
        await expect(
          cargoDeliveryAuthorization.getCertificationPath([], [privateGatewayCDACertificate]),
        ).toResolve();
      });

      async function retrieveCDA(cca: CargoCollectionAuthorization): Promise<Certificate> {
        const { payload: ccr } = await cca.unwrapPayload(publicGatewayPrivateKey);
        return ccr.cargoDeliveryAuthorization;
      }
    });

    async function retrieveCCA(): Promise<CargoCollectionAuthorization> {
      expect(mockCollectCargo).toBeCalled();
      const ccaSerialized = bufferToArray(mockCollectCargo.mock.calls[0][0]);
      return CargoCollectionAuthorization.deserialize(ccaSerialized);
    }
  });

  test('Malformed cargo should be logged and ignored', async () => {
    mockCollectCargo.mockReturnValueOnce(arrayToAsyncIterable([Buffer.from('malformed')]));

    await runCourierSync(getParentStream());

    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Ignoring malformed/invalid cargo', {
        err: expect.objectContaining({ type: RAMFSyntaxError.name }),
      }),
    );
  });

  test('Cargo by unauthorized sender should be logged and ignored', async () => {
    const { parcelSerialized } = await makeDummyParcel();
    const cargo = new Cargo(
      await privateGatewayPDACertificate.calculateSubjectPrivateAddress(),
      publicGatewayPDACertificate, // Sent by the public gateway, but using wrong certificate
      await makeCargoPayloadFromMessages([parcelSerialized]),
    );
    const cargoSerialized = Buffer.from(await cargo.serialize(publicGatewayPrivateKey));
    mockCollectCargo.mockReturnValueOnce(arrayToAsyncIterable([cargoSerialized]));

    await runCourierSync(getParentStream());

    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Ignoring cargo by unauthorized sender', {
        cargoId: cargo.id,
        err: expect.objectContaining({ type: InvalidMessageError.name }),
      }),
    );
    await expect(getStoredParcelKeys()).resolves.toHaveLength(0);
  });

  test('Cargo with invalid payload should be logged and ignored', async () => {
    const { cargo, cargoSerialized } = await makeDummyCargo(Buffer.from('malformed payload'));
    mockCollectCargo.mockReturnValueOnce(arrayToAsyncIterable([cargoSerialized]));

    await runCourierSync(getParentStream());

    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Ignored cargo with invalid payload', {
        cargoId: cargo.id,
        err: expect.objectContaining({ type: CMSError.name }),
      }),
    );
  });

  test('Malformed message encapsulated in cargo should be logged and ignored', async () => {
    const { cargo, cargoSerialized } = await makeDummyCargoFromMessages(
      Buffer.from('malformed message'),
    );
    mockCollectCargo.mockReturnValueOnce(arrayToAsyncIterable([cargoSerialized]));

    await runCourierSync(getParentStream());

    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Ignoring invalid/malformed message', {
        cargoId: cargo.id,
        err: expect.objectContaining({ type: InvalidMessageError.name }),
      }),
    );
  });

  describe('Encapsulated parcels', () => {
    test('Well-formed yet invalid parcels should be logged and ignored', async () => {
      const { pdaCertPath, keyPairSet } = await pkiFixtureRetriever();
      const { parcelSerialized: invalidParcelSerialized } = await makeParcel(
        MessageDirection.FROM_INTERNET,
        { ...pdaCertPath, pdaGrantee: pdaCertPath.publicGateway },
        { ...keyPairSet, pdaGrantee: keyPairSet.publicGateway },
      );
      const { cargo, cargoSerialized } = await makeDummyCargoFromMessages(invalidParcelSerialized);
      mockCollectCargo.mockReturnValueOnce(arrayToAsyncIterable([cargoSerialized]));

      await runCourierSync(getParentStream());

      expect(mockLogs).toContainEqual(
        partialPinoLog('info', 'Ignoring invalid parcel', {
          cargoId: cargo.id,
          err: expect.objectContaining({ type: InvalidMessageError.name }),
        }),
      );
      await expect(getStoredParcelKeys()).resolves.toHaveLength(0);
    });

    test('Valid parcels should be stored', async () => {
      const { parcel, parcelSerialized } = await makeDummyParcel();
      const { cargo, cargoSerialized } = await makeDummyCargoFromMessages(parcelSerialized);
      mockCollectCargo.mockReturnValueOnce(arrayToAsyncIterable([cargoSerialized]));

      await runCourierSync(getParentStream());

      const parcelKeys = await asyncIterableToArray(
        parcelStore.streamEndpointBound([parcel.recipientAddress], false),
      );
      expect(parcelKeys).toHaveLength(1);
      await expect(
        parcelStore.retrieve(parcelKeys[0], MessageDirection.FROM_INTERNET),
      ).resolves.toEqual(parcelSerialized);
      expect(mockLogs).toContainEqual(
        partialPinoLog('info', 'Stored parcel', {
          cargoId: cargo.id,
          parcel: { id: parcel.id, recipientAddress: parcel.recipientAddress, key: parcelKeys[0] },
        }),
      );
    });

    test('Parcel should be added to parcel collection', async () => {
      const { parcel, parcelSerialized } = await makeDummyParcel();
      const { cargoSerialized } = await makeDummyCargoFromMessages(parcelSerialized);
      mockCollectCargo.mockReturnValueOnce(arrayToAsyncIterable([cargoSerialized]));

      await runCourierSync(getParentStream());

      const parcelCollectionRepo = getRepository(ParcelCollection);
      const collection = await parcelCollectionRepo.findOneOrFail({
        parcelId: parcel.id,
        recipientEndpointAddress: parcel.recipientAddress,
        senderEndpointPrivateAddress:
          await parcel.senderCertificate.calculateSubjectPrivateAddress(),
      });
      expect(collection.parcelExpiryDate).toEqual(parcel.expiryDate);
    });

    test('Parent process should be notified about collection if parcel is new', async () => {
      const { parcel, parcelSerialized } = await makeDummyParcel();
      const { cargoSerialized } = await makeDummyCargoFromMessages(parcelSerialized);
      mockCollectCargo.mockReturnValueOnce(arrayToAsyncIterable([cargoSerialized]));
      const parentStream = getParentStream();
      const getParentProcessMessages = recordReadableStreamMessages(parentStream);

      await runCourierSync(parentStream);

      expect(getParentProcessMessages()).toContainEqual<ParcelCollectionNotification>({
        parcelKey: expect.stringContaining(parcel.recipientAddress),
        type: 'parcelCollection',
      });
    });

    test('Parent process should not be notified about collection if parcel is old', async () => {
      const { parcel, parcelSerialized } = await makeDummyParcel();
      const parcelCollectionRepo = getRepository(ParcelCollection);
      await parcelCollectionRepo.save(
        parcelCollectionRepo.create({
          parcelExpiryDate: parcel.expiryDate,
          parcelId: parcel.id,
          recipientEndpointAddress: parcel.recipientAddress,
          senderEndpointPrivateAddress:
            await parcel.senderCertificate.calculateSubjectPrivateAddress(),
        }),
      );
      const { cargoSerialized } = await makeDummyCargoFromMessages(parcelSerialized);
      mockCollectCargo.mockReturnValueOnce(arrayToAsyncIterable([cargoSerialized]));
      const parentStream = getParentStream();
      const getParentProcessMessages = recordReadableStreamMessages(parentStream);

      await runCourierSync(parentStream);

      expect(getParentProcessMessages()).not.toContainEqual(
        expect.objectContaining({
          type: 'parcelCollection',
        }),
      );
    });
  });

  describe('Encapsulated parcel collection ACKs', () => {
    test('ACKed parcel should be deleted', async () => {
      const { pdaCertPath, keyPairSet } = await pkiFixtureRetriever();
      const { parcel, parcelSerialized } = await makeParcel(
        MessageDirection.TOWARDS_INTERNET,
        pdaCertPath,
        keyPairSet,
      );
      await parcelStore.storeInternetBound(parcelSerialized, parcel);
      const ackSerialized = makeParcelCollectionAck(
        await parcel.senderCertificate.calculateSubjectPrivateAddress(),
        parcel.recipientAddress,
        parcel.id,
      );
      const { cargo, cargoSerialized } = await makeDummyCargoFromMessages(ackSerialized);
      mockCollectCargo.mockReturnValueOnce(arrayToAsyncIterable([cargoSerialized]));

      await runCourierSync(getParentStream());

      await expect(asyncIterableToArray(parcelStore.listInternetBound())).resolves.toHaveLength(0);
      expect(mockLogs).toContainEqual(
        partialPinoLog('info', 'Deleting ACKed parcel', {
          cargoId: cargo.id,
          parcel: {
            id: parcel.id,
            recipientAddress: parcel.recipientAddress,
            senderAddress: await parcel.senderCertificate.calculateSubjectPrivateAddress(),
          },
        }),
      );
    });

    function makeParcelCollectionAck(
      senderEndpointPrivateAddress: string,
      recipientEndpointAddress: string,
      parcelId: string,
    ): Buffer {
      const ack = new ParcelCollectionAck(
        senderEndpointPrivateAddress,
        recipientEndpointAddress,
        parcelId,
      );
      return Buffer.from(ack.serialize());
    }
  });

  test('Multiple cargoes should be processed', async () => {
    const { parcelSerialized: parcel1Serialized } = await makeDummyParcel();
    const { cargoSerialized: cargo1Serialized } = await makeDummyCargoFromMessages(
      parcel1Serialized,
    );
    const { parcelSerialized: parcel2Serialized } = await makeDummyParcel();
    const { cargoSerialized: cargo2Serialized } = await makeDummyCargoFromMessages(
      parcel2Serialized,
    );
    mockCollectCargo.mockReturnValueOnce(
      arrayToAsyncIterable([cargo1Serialized, cargo2Serialized]),
    );

    await runCourierSync(getParentStream());

    const { pdaCertPath } = await pkiFixtureRetriever();
    const parcelKeys = await asyncIterableToArray(
      parcelStore.streamEndpointBound(
        [await pdaCertPath.privateEndpoint.calculateSubjectPrivateAddress()],
        false,
      ),
    );
    expect(parcelKeys).toHaveLength(2);
  });

  async function makeDummyParcel(): Promise<GeneratedParcel> {
    const { pdaCertPath, keyPairSet } = await pkiFixtureRetriever();
    return makeParcel(MessageDirection.FROM_INTERNET, pdaCertPath, keyPairSet);
  }

  async function makeDummyCargo(payloadSerialized: Buffer): Promise<GeneratedCargo> {
    const { cdaCertPath, keyPairSet } = pkiFixtureRetriever();
    return makeCargo(cdaCertPath, keyPairSet, payloadSerialized);
  }

  async function makeDummyCargoFromMessages(
    ...messagesSerialized: readonly Buffer[]
  ): Promise<GeneratedCargo> {
    const payloadSerialized = await makeCargoPayloadFromMessages(messagesSerialized);
    return makeDummyCargo(payloadSerialized);
  }

  async function makeCargoPayloadFromMessages(
    messagesSerialized: readonly Buffer[],
  ): Promise<Buffer> {
    const { cdaCertPath } = pkiFixtureRetriever();
    const cargoMessageSet = new CargoMessageSet(messagesSerialized.map(bufferToArray));
    const payloadEncrypted = await SessionlessEnvelopedData.encrypt(
      await cargoMessageSet.serialize(),
      cdaCertPath.privateGateway,
    );
    return Buffer.from(payloadEncrypted.serialize());
  }

  async function getStoredParcelKeys(): Promise<readonly string[]> {
    const fileStore = Container.get(FileStore);
    return asyncIterableToArray(fileStore.listObjects(ParcelStore.FILE_STORE_PREFIX));
  }
});

describe('Wait period', () => {
  test('Parent should be notified about WAIT stage at the start', async () => {
    const parentStream = getParentStream();
    const getParentStreamMessages = recordReadableStreamMessages(parentStream);

    await runCourierSync(getParentStream());

    const stages = getParentStreamMessages();
    expect(stages[1]).toEqual<CourierSyncStageNotification>({
      stage: CourierSyncStage.WAIT,
      type: 'stage',
    });
  });

  test('Client should wait for 5 seconds before delivering cargo', async () => {
    await runCourierSync(getParentStream());

    expect(sleepSeconds).toBeCalledWith(5);
    expect(sleepSeconds).toHaveBeenCalledAfter(mockCollectCargo as any);
  });
});

describe('Cargo delivery', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    if (jest.isMockFunction(ParcelStore.prototype.listInternetBound)) {
      getMockInstance(ParcelStore.prototype.listInternetBound).mockRestore();
    }
    if (jest.isMockFunction(ParcelStore.prototype.retrieve)) {
      getMockInstance(ParcelStore.prototype.retrieve).mockRestore();
    }
  });

  test('Parent should be notified about DELIVERY stage at the start', async () => {
    const parentStream = getParentStream();
    const getParentStreamMessages = recordReadableStreamMessages(parentStream);

    await runCourierSync(getParentStream());

    const stages = getParentStreamMessages();
    expect(stages[2]).toEqual<CourierSyncStageNotification>({
      stage: CourierSyncStage.DELIVERY,
      type: 'stage',
    });
  });

  test('CogRPC client should be closed when delivery fails', async () => {
    const error = new Error('nope.jpeg');
    mockDeliverCargo.mockReturnValueOnce(async function* (): AsyncIterable<any> {
      throw error;
    });

    await expect(runCourierSync(getParentStream())).resolves.toEqual(
      CourierSyncExitCode.FAILED_SYNC,
    );

    expect(mockCogRPCClose).toBeCalledWith();
    expect(mockLogs).toContainEqual(
      partialPinoLog('fatal', 'Sync failed', {
        err: expect.objectContaining({ message: error.message }),
      }),
    );
  });

  test('Recipient should be paired public gateway', async () => {
    await makeAndStoreParcel();

    await runCourierSync(getParentStream());

    const deliveryRequests = await getCargoDeliveryRequests();
    const cargo = await Cargo.deserialize(bufferToArray(deliveryRequests[0].cargo));
    expect(cargo.recipientAddress).toEqual(`https://${DEFAULT_PUBLIC_GATEWAY}`);
  });

  test('Expiry date should be that of last parcel', async () => {
    await makeAndStoreParcel();
    jest.useFakeTimers();
    jest.advanceTimersByTime(2_000);
    const { parcel: latestParcel } = await makeAndStoreParcel();

    await runCourierSync(getParentStream());

    const [deliveryRequest] = await getCargoDeliveryRequests();
    const cargo = await Cargo.deserialize(bufferToArray(deliveryRequest.cargo));
    expect(cargo.expiryDate).toEqual(latestParcel.expiryDate);
  });

  test('Expiry date should be that of last parcel collection ACK', async () => {
    const now = new Date();
    now.setMilliseconds(0);
    await storeParcelCollection(addSeconds(now, 2));
    const newestCollectionACK = await storeParcelCollection(addSeconds(now, 3));

    await runCourierSync(getParentStream());

    const [deliveryRequest] = await getCargoDeliveryRequests();
    const cargo = await Cargo.deserialize(bufferToArray(deliveryRequest.cargo));
    expect(cargo.expiryDate).toEqual(newestCollectionACK.parcelExpiryDate);
  });

  test('Sender certificate should be the one issued by public gateway', async () => {
    await makeAndStoreParcel();

    await runCourierSync(getParentStream());

    const deliveryRequests = await getCargoDeliveryRequests();
    const cargo = await Cargo.deserialize(bufferToArray(deliveryRequests[0].cargo));
    expect(cargo.senderCertificate.isEqual(privateGatewayPDACertificate)).toBeTrue();
  });

  test('Sender certificate chain should be empty', async () => {
    await makeAndStoreParcel();

    await runCourierSync(getParentStream());

    const deliveryRequests = await getCargoDeliveryRequests();
    const cargo = await Cargo.deserialize(bufferToArray(deliveryRequests[0].cargo));
    expect(cargo.senderCaCertificateChain).toHaveLength(0);
  });

  describe('Cargo contents', () => {
    test('No cargo should be delivered if there are no parcels or collection ACKs', async () => {
      await runCourierSync(getParentStream());

      await expect(getCargoDeliveryRequests()).resolves.toHaveLength(0);
    });

    test('Queued parcels should be included in cargo', async () => {
      const { parcelSerialized } = await makeAndStoreParcel();

      await runCourierSync(getParentStream());

      const deliveryRequests = await getCargoDeliveryRequests();
      expect(deliveryRequests).toHaveLength(1);
      const cargoMessages = await unwrapCargoMessages(deliveryRequests[0].cargo);
      expect(cargoMessages).toEqual([parcelSerialized]);
    });

    test('Recently-deleted parcels should be gracefully skipped', async () => {
      const parcel1Key = 'key1';
      jest.spyOn(ParcelStore.prototype, 'listInternetBound').mockReturnValueOnce(
        arrayToAsyncIterable([
          { parcelKey: parcel1Key, expiryDate: new Date() },
          { parcelKey: 'key2', expiryDate: new Date() },
        ]),
      );
      const parcelStoreRetrieveSpy = jest.spyOn(ParcelStore.prototype, 'retrieve');
      parcelStoreRetrieveSpy.mockResolvedValueOnce(null);
      const parcel2Serialized = Buffer.from('foo');
      parcelStoreRetrieveSpy.mockResolvedValueOnce(parcel2Serialized);

      await runCourierSync(getParentStream());

      const deliveryRequests = await getCargoDeliveryRequests();
      expect(deliveryRequests).toHaveLength(1);
      const cargoMessages = await unwrapCargoMessages(deliveryRequests[0].cargo);
      expect(cargoMessages).toEqual([parcel2Serialized]);
      expect(mockLogs).toContainEqual(
        partialPinoLog('debug', 'Skipped deleted parcel', {
          parcelKey: parcel1Key,
        }),
      );
    });

    test('Collection acknowledgement for valid parcels should be included in cargo', async () => {
      const collectionACK = await storeParcelCollection(addSeconds(new Date(), 2));

      await runCourierSync(getParentStream());

      const deliveryRequests = await getCargoDeliveryRequests();
      expect(deliveryRequests).toHaveLength(1);
      const cargoMessages = await unwrapCargoMessages(deliveryRequests[0].cargo);
      expect(cargoMessages).toHaveLength(1);
      const collectionACKDeserialized = ParcelCollectionAck.deserialize(
        bufferToArray(cargoMessages[0]),
      );
      expect(collectionACKDeserialized.parcelId).toEqual(collectionACK.parcelId);
      expect(collectionACKDeserialized.recipientEndpointAddress).toEqual(
        collectionACK.recipientEndpointAddress,
      );
      expect(collectionACKDeserialized.senderEndpointPrivateAddress).toEqual(
        collectionACK.senderEndpointPrivateAddress,
      );
    });
  });

  describe('Delivery ACKs', () => {
    test('Generated ACK should be UUID4', async () => {
      await storeParcelCollection(addSeconds(new Date(), 2));

      await runCourierSync(getParentStream());

      const [deliveryRequest] = await getCargoDeliveryRequests();
      expect(deliveryRequest.localId).toSatisfy((i) => uuid.test(i));
    });

    test('ACK should be logged when received', async () => {
      const ackId = 'the ack';
      mockDeliverCargo.mockReturnValueOnce(arrayToAsyncIterable([ackId]));
      await makeAndStoreParcel();

      await runCourierSync(getParentStream());

      expect(mockLogs).toContainEqual(
        partialPinoLog('debug', 'Received parcel delivery acknowledgement', {
          ackId,
        }),
      );
    });
  });

  async function getCargoDeliveryRequests(): Promise<readonly CargoDeliveryRequest[]> {
    expect(mockDeliverCargo).toBeCalled();

    const iterable = mockDeliverCargo.mock.calls[0][0];
    return asyncIterableToArray(iterable);
  }

  async function makeAndStoreParcel(): Promise<GeneratedParcel> {
    const { pdaCertPath, keyPairSet } = await pkiFixtureRetriever();
    const { parcel, parcelSerialized } = await makeParcel(
      MessageDirection.TOWARDS_INTERNET,
      pdaCertPath,
      keyPairSet,
    );

    await parcelStore.storeInternetBound(parcelSerialized, parcel);

    return { parcel, parcelSerialized };
  }

  async function storeParcelCollection(parcelExpiryDate: Date): Promise<ParcelCollection> {
    const collectionACKRepo = getRepository(ParcelCollection);
    const randomString = uuid();
    const ack = collectionACKRepo.create({
      parcelExpiryDate,
      parcelId: randomString,
      recipientEndpointAddress: randomString,
      senderEndpointPrivateAddress: randomString,
    });
    await collectionACKRepo.save(ack);
    return ack;
  }

  async function unwrapCargoMessages(cargoSerialized: Buffer): Promise<readonly Buffer[]> {
    const cargo = await Cargo.deserialize(bufferToArray(cargoSerialized));
    const { payload: cargoMessageSet } = await cargo.unwrapPayload(publicGatewayPrivateKey);
    return cargoMessageSet.messages.map((m) => Buffer.from(m));
  }
});

describe('Completion', () => {
  test('Subprocess should end with code 0 when sync completes successfully', async () => {
    await expect(runCourierSync(getParentStream())).resolves.toEqual(CourierSyncExitCode.OK);

    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Sync completed successfully'));
  });

  test('CogRPC client should be closed when sync completes successfully', async () => {
    await runCourierSync(getParentStream());

    expect(mockCogRPCClose).toBeCalledWith();
  });
});
