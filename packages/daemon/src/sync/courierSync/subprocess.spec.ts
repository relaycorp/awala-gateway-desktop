import { CogRPCClient } from '@relaycorp/cogrpc';
import {
  CargoCollectionAuthorization,
  Certificate,
  derSerializePublicKey,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { addDays, subMinutes } from 'date-fns';
import { v4 } from 'default-gateway';

import { CourierSyncStage } from '.';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { generatePKIFixture, mockGatewayRegistration } from '../../testUtils/crypto';
import { setUpTestDBConnection } from '../../testUtils/db';
import { arrayToAsyncIterable } from '../../testUtils/iterables';
import { getMockInstance, mockSpy } from '../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
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

let nodeIdCertificate: Certificate;
let publicGatewayPrivateKey: CryptoKey;
let publicGatewayIdCertificate: Certificate;
const pkiFixtureRetriever = generatePKIFixture((keyPairSet, certPath) => {
  nodeIdCertificate = certPath.privateGateway;

  publicGatewayPrivateKey = keyPairSet.publicGateway.privateKey;
  publicGatewayIdCertificate = certPath.publicGateway;
});
const undoGatewayRegistration = mockGatewayRegistration(pkiFixtureRetriever);

const mockCollectCargo = mockSpy(jest.fn(), () => arrayToAsyncIterable([]));
const mockDeliverCargo = mockSpy(jest.fn());
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

  await expect(runCourierSync(getParentStream())).resolves.toEqual(1);

  expect(mockLogs).toContainEqual(partialPinoLog('fatal', 'Private gateway is unregistered'));
});

test('Subprocess should error out if default gateway could not be found', async () => {
  const gatewayError = new Error('Cannot find gateway IP address');
  getMockInstance(v4).mockRejectedValue(gatewayError);

  await expect(runCourierSync(getParentStream())).resolves.toEqual(2);

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

  await expect(runCourierSync(getParentStream())).resolves.toEqual(3);

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

      expect(senderCertificate.isEqual(nodeIdCertificate)).toBeFalse();
      await expect(derSerializePublicKey(await senderCertificate.getPublicKey())).resolves.toEqual(
        await derSerializePublicKey(await nodeIdCertificate.getPublicKey()),
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

  test.todo('Cargo should be stored with no validation');

  test.todo('Parent process should be notified about new parcels');

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

  test.todo('CogRPC client should be closed when delivery fails');

  test.todo('One cargo should be delivered if all messages fit in it');

  test.todo('Multiple cargoes should be delivered if messages do not fit in one');

  test.todo('Recipient should be paired public gateway if registered');

  test.todo('Recipient should be default public gateway if unregistered');

  test.todo('Start date should be 90 minutes in the past to tolerate clock drift');

  test.todo('Expiry date should be that of latest parcel');

  test.todo('Sender should be self-issued certificate for own key');

  test.todo('Sender certificate chain should be empty');
});

describe('Completion', () => {
  test('Subprocess should end with code 0 when sync completes successfully', async () => {
    await expect(runCourierSync(getParentStream())).resolves.toEqual(0);

    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Sync completed successfully'));
  });

  test('CogRPC client should be closed when sync completes successfully', async () => {
    await runCourierSync(getParentStream());

    expect(mockCogRPCClose).toBeCalledWith();
  });
});
