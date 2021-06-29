import { CogRPCClient } from '@relaycorp/cogrpc';
import {
  Cargo,
  CargoCollectionAuthorization,
  CargoDeliveryRequest,
  Certificate,
  derSerializePublicKey,
  ParcelCollectionAck,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { addDays, addSeconds, subMinutes } from 'date-fns';
import { v4 } from 'default-gateway';
import { Container } from 'typedi';
import { getRepository } from 'typeorm';
import uuid from 'uuid-random';

import { CourierSyncExitCode, CourierSyncStage } from '.';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { PendingParcelCollectionACK } from '../../entity/PendingParcelCollectionACK';
import { ParcelDirection, ParcelStore } from '../../parcelStore';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { generatePKIFixture, mockGatewayRegistration } from '../../testUtils/crypto';
import { setUpTestDBConnection } from '../../testUtils/db';
import { arrayToAsyncIterable, asyncIterableToArray } from '../../testUtils/iterables';
import { getMockInstance, mockSpy } from '../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { GeneratedParcel, makeParcel } from '../../testUtils/ramf';
import { makeStubPassThrough, recordReadableStreamMessages } from '../../testUtils/stream';
import { sleepSeconds } from '../../utils/timing';
import { CourierSyncStageNotification } from './messaging';
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

let privateGatewayCertificate: Certificate;
let publicGatewayPrivateKey: CryptoKey;
let publicGatewayIdCertificate: Certificate;
const pkiFixtureRetriever = generatePKIFixture((keyPairSet, certPath) => {
  privateGatewayCertificate = certPath.privateGateway;

  publicGatewayPrivateKey = keyPairSet.publicGateway.privateKey;
  publicGatewayIdCertificate = certPath.publicGateway;
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

const getParentStream = makeStubPassThrough();

test('Subprocess should error out if private gateway is unregistered', async () => {
  undoGatewayRegistration();

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
    partialPinoLog('fatal', 'Failed to initialize CogRPC client', {
      err: expect.objectContaining({ message: gatewayError.message }),
    }),
  );
});

describe('Cargo collection', () => {
  test('Parent should be notified about COLLECTION stage at the start', async () => {
    const parentStream = getParentStream();
    const getParentStreamMessages = recordReadableStreamMessages(parentStream);

    await runCourierSync(getParentStream());

    const [firstStage] = getParentStreamMessages();
    expect(firstStage).toEqual<CourierSyncStageNotification>({
      stage: CourierSyncStage.COLLECTION,
      type: 'stage',
    });
  });

  test('CogRPC client should be closed when collection fails', async () => {
    const error = new Error('nope.jpeg');
    mockCollectCargo.mockRejectedValue(error);

    await expect(runCourierSync(getParentStream())).resolves.toEqual(3);

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

    test('Sender should be self-issued certificate for own key', async () => {
      await runCourierSync(getParentStream());

      const cca = await retrieveCCA();
      const senderCertificate = cca.senderCertificate;

      expect(senderCertificate.isEqual(privateGatewayCertificate)).toBeFalse();
      await expect(derSerializePublicKey(await senderCertificate.getPublicKey())).resolves.toEqual(
        await derSerializePublicKey(await privateGatewayCertificate.getPublicKey()),
      );

      expect(senderCertificate.startDate).toEqual(cca.creationDate);
      expect(senderCertificate.expiryDate).toEqual(cca.expiryDate);
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
        expect(cargoDeliveryAuthorization.isEqual(publicGatewayIdCertificate)).toBeFalse();
        await expect(
          derSerializePublicKey(await cargoDeliveryAuthorization.getPublicKey()),
        ).resolves.toEqual(
          await derSerializePublicKey(await publicGatewayIdCertificate.getPublicKey()),
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
          cargoDeliveryAuthorization.getCertificationPath([], [cca.senderCertificate]),
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

  describe('Encapsulated parcels', () => {
    test.todo('Parcel ACK should be added to queue');

    test.todo('Parent process should be notified about new parcels');
  });

  describe('Encapsulated parcel collection ACKs', () => {
    test.todo('ACKed parcel should be deleted');
  });

  test.todo('The first 100 cargoes should be accepted');

  test.todo('No more than 100 cargoes should be accepted');
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
    if (jest.isMockFunction(ParcelStore.prototype.listActiveBoundForInternet)) {
      getMockInstance(ParcelStore.prototype.listActiveBoundForInternet).mockRestore();
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

    await expect(runCourierSync(getParentStream())).resolves.toEqual(3);

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
    await storeParcelCollectionAck(addSeconds(now, 2));
    const newestCollectionACK = await storeParcelCollectionAck(addSeconds(now, 3));

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
    expect(cargo.senderCertificate.isEqual(privateGatewayCertificate)).toBeTrue();
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
      jest.spyOn(ParcelStore.prototype, 'listActiveBoundForInternet').mockReturnValueOnce(
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
      const collectionACK = await storeParcelCollectionAck(addSeconds(new Date(), 2));

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
      await storeParcelCollectionAck(addSeconds(new Date(), 2));

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
    const { certPath, keyPairSet } = await pkiFixtureRetriever();
    const { parcel, parcelSerialized } = await makeParcel(
      ParcelDirection.ENDPOINT_TO_INTERNET,
      certPath,
      keyPairSet,
    );

    const parcelStore = Container.get(ParcelStore);
    await parcelStore.store(parcelSerialized, parcel, ParcelDirection.ENDPOINT_TO_INTERNET);

    return { parcel, parcelSerialized };
  }

  async function storeParcelCollectionAck(
    parcelExpiryDate: Date,
  ): Promise<PendingParcelCollectionACK> {
    const collectionACKRepo = getRepository(PendingParcelCollectionACK);
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
