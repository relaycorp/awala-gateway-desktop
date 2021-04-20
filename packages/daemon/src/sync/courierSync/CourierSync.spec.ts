import { CogRPCClient } from '@relaycorp/cogrpc';
import {
  CargoCollectionAuthorization,
  Certificate,
  derSerializePublicKey,
} from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { addDays, subMinutes } from 'date-fns';
import { v4 } from 'default-gateway';
import pipe from 'it-pipe';
import { waitUntilUsedOnHost } from 'tcp-port-used';
import { Container } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../testUtils/db';
import {
  arrayToAsyncIterable,
  asyncIterableToArray,
  iterableTake,
} from '../../testUtils/iterables';
import { getMockInstance, mockSpy } from '../../testUtils/jest';
import { mockPrivateKeyStore } from '../../testUtils/keystores';
import { getPromiseRejection } from '../../testUtils/promises';
import { sleepSeconds } from '../../utils/timing';
import { GatewayRegistrar } from '../publicGateway/GatewayRegistrar';
import {
  COURIER_PORT,
  CourierConnectionStatus,
  CourierSync,
  CourierSyncStage,
} from './CourierSync';
import { DisconnectedFromCourierError, UnregisteredGatewayError } from './errors';

jest.mock('default-gateway', () => ({ v4: jest.fn() }));
const mockGatewayIPAddr = '192.168.0.12';
beforeEach(() => {
  getMockInstance(v4).mockRestore();
  getMockInstance(v4).mockResolvedValue({ gateway: mockGatewayIPAddr });
});

jest.mock('@relaycorp/cogrpc', () => ({ CogRPCClient: { init: jest.fn() } }));
jest.mock('tcp-port-used', () => ({ waitUntilUsedOnHost: jest.fn() }));
jest.mock('../../utils/timing');

setUpTestDBConnection();
useTemporaryAppDirs();
const privateKeyStore = mockPrivateKeyStore();

let courierSync: CourierSync;
beforeEach(() => {
  courierSync = new CourierSync(
    Container.get(GatewayRegistrar),
    Container.get(Config),
    privateKeyStore,
  );
});

const mockRegistrarGetPublicGateway = mockSpy(
  jest.spyOn(GatewayRegistrar.prototype, 'getPublicGateway'),
);
let nodePrivateKey: CryptoKey;
let nodeIdCertificate: Certificate;
let publicGatewayPrivateKey: CryptoKey;
let publicGatewayIdCertificate: Certificate;
beforeAll(async () => {
  const keyPairSet = await generateNodeKeyPairSet();
  const certPath = await generatePDACertificationPath(keyPairSet);

  nodeIdCertificate = certPath.privateGateway;
  nodePrivateKey = keyPairSet.privateGateway.privateKey;

  publicGatewayPrivateKey = keyPairSet.publicGateway.privateKey;
  publicGatewayIdCertificate = certPath.publicGateway;
});
beforeEach(async () => {
  getMockInstance(GatewayRegistrar.prototype.getPublicGateway).mockResolvedValue({
    identityCertificate: publicGatewayIdCertificate,
    publicAddress: DEFAULT_PUBLIC_GATEWAY,
  });

  await privateKeyStore.saveNodeKey(nodePrivateKey, nodeIdCertificate);

  const config = Container.get(Config);
  await config.set(ConfigKey.PUBLIC_GATEWAY_ADDRESS, DEFAULT_PUBLIC_GATEWAY);
  await config.set(ConfigKey.NODE_KEY_SERIAL_NUMBER, nodeIdCertificate.getSerialNumberHex());
});

describe('sync', () => {
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

  test('Error should be thrown if private gateway is unregistered', async () => {
    mockRegistrarGetPublicGateway.mockResolvedValue(null);

    const syncError = await getPromiseRejection(
      asyncIterableToArray(courierSync.sync()),
      UnregisteredGatewayError,
    );

    expect(syncError.message).toEqual('Private gateway is unregistered');
  });

  test('Client should connect to port 21473 on the default gateway', async () => {
    await asyncIterableToArray(courierSync.sync());

    expect(CogRPCClient.init).toBeCalledWith(`https://${mockGatewayIPAddr}:21473`);
  });

  test('Error should be thrown if default gateway could not be found', async () => {
    const gatewayError = new Error('Cannot find gateway IP address');
    getMockInstance(v4).mockRejectedValue(gatewayError);

    const syncError = await getPromiseRejection(
      asyncIterableToArray(courierSync.sync()),
      DisconnectedFromCourierError,
    );

    expect(syncError.message).toMatch(/^Could not find default system gateway:/);
    expect(syncError.cause()).toEqual(gatewayError);
  });

  describe('Cargo collection', () => {
    test('COLLECTION stage should be yielded at the start', async () => {
      const stages = await asyncIterableToArray(courierSync.sync());

      expect(stages[0]).toEqual(CourierSyncStage.COLLECTION);
    });

    describe('Cargo Collection Authorization', () => {
      test('Recipient should be public gateway', async () => {
        await asyncIterableToArray(courierSync.sync());

        const cca = await retrieveCCA();
        expect(cca.recipientAddress).toEqual(`https://${DEFAULT_PUBLIC_GATEWAY}`);
      });

      test('Creation date should be 90 minutes in the past to tolerate clock drift', async () => {
        await asyncIterableToArray(courierSync.sync());

        const cca = await retrieveCCA();
        expect(cca.creationDate).toBeBefore(subMinutes(new Date(), 90));
        expect(cca.creationDate).toBeAfter(subMinutes(new Date(), 92));
      });

      test('Expiry date should be 14 days in the future', async () => {
        await asyncIterableToArray(courierSync.sync());

        const cca = await retrieveCCA();
        expect(cca.expiryDate).toBeAfter(addDays(new Date(), 13));
        expect(cca.expiryDate).toBeBefore(addDays(new Date(), 14));
      });

      test('Sender should be self-issued certificate for own key', async () => {
        await asyncIterableToArray(courierSync.sync());

        const cca = await retrieveCCA();
        const senderCertificate = cca.senderCertificate;

        expect(senderCertificate.isEqual(nodeIdCertificate)).toBeFalse();
        await expect(
          derSerializePublicKey(await senderCertificate.getPublicKey()),
        ).resolves.toEqual(await derSerializePublicKey(await nodeIdCertificate.getPublicKey()));

        expect(senderCertificate.startDate).toEqual(cca.creationDate);
        expect(senderCertificate.expiryDate).toEqual(cca.expiryDate);
      });

      test('Sender certificate chain should be empty', async () => {
        await asyncIterableToArray(courierSync.sync());

        const cca = await retrieveCCA();
        expect(cca.senderCaCertificateChain).toEqual([]);
      });

      describe('Cargo Delivery Authorization in Cargo Collection Request', () => {
        test('Public key should be that of the public gateway', async () => {
          await asyncIterableToArray(courierSync.sync());

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
          await asyncIterableToArray(courierSync.sync());

          const cca = await retrieveCCA();
          const cargoDeliveryAuthorization = await retrieveCDA(cca);
          expect(cargoDeliveryAuthorization.expiryDate).toBeAfter(addDays(new Date(), 13));
          expect(cargoDeliveryAuthorization.expiryDate).toBeBefore(addDays(new Date(), 14));
        });

        test('Issuer should be private gateway', async () => {
          await asyncIterableToArray(courierSync.sync());

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

    test.todo('Incoming cargo processor should be notified about new cargo');

    test.todo('The first 100 cargoes should be accepted');

    test.todo('No more than 100 cargoes should be accepted');
  });

  describe('Wait period', () => {
    test('WAIT stage should be yielded at the start', async () => {
      const stages = await asyncIterableToArray(courierSync.sync());

      expect(stages[1]).toEqual(CourierSyncStage.WAIT);
    });

    test('Client should wait for 5 seconds before delivering cargo', async () => {
      await asyncIterableToArray(courierSync.sync());

      expect(sleepSeconds).toBeCalledWith(5);
      expect(sleepSeconds).toHaveBeenCalledAfter(mockCollectCargo as any);
    });
  });

  describe('Cargo delivery', () => {
    test('DELIVERY stage should be yielded at the start', async () => {
      const stages = await asyncIterableToArray(courierSync.sync());

      expect(stages[2]).toEqual(CourierSyncStage.DELIVERY);
    });

    test.todo('Outgoing cargo generator should be started');

    test.todo('Each generated cargo should be delivered');

    test.todo('Delivery should end when outgoing cargo generator completes normally');

    test.todo('Delivery should end when outgoing cargo generator errors out');
  });

  describe('Completion', () => {
    test.todo('Iterator should end when sync completes successfully');

    test('CogRPC client should be closed when sync completes successfully', async () => {
      await asyncIterableToArray(courierSync.sync());

      expect(mockCogRPCClose).toBeCalledWith();
    });

    test('CogRPC client should be closed when collection fails', async () => {
      mockCollectCargo.mockRejectedValue(new Error());

      await expect(asyncIterableToArray(courierSync.sync())).toReject();

      expect(mockCogRPCClose).toBeCalledWith();
    });

    test.todo('CogRPC client should be closed when delivery fails');
  });
});

describe('streamStatus', () => {
  beforeEach(() => {
    getMockInstance(waitUntilUsedOnHost).mockRestore();
  });

  describe('Default gateway', () => {
    test('Failure to get default gateway should be quietly ignored', async () => {
      getMockInstance(v4).mockRejectedValue(new Error('Device is not connected to any network'));

      await pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray);

      expect(waitUntilUsedOnHost).not.toBeCalled();
    });

    test('Default gateway should be pinged on port 21473', async () => {
      await pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray);

      expect(waitUntilUsedOnHost).toBeCalledWith(COURIER_PORT, mockGatewayIPAddr, 500, 3_000);
    });

    test('Any change to the default gateway should be picked up', async () => {
      getMockInstance(v4).mockRestore();
      getMockInstance(v4).mockResolvedValueOnce({ gateway: mockGatewayIPAddr });
      const newGatewayIPAddr = `${mockGatewayIPAddr}1`;
      getMockInstance(v4).mockResolvedValueOnce({ gateway: newGatewayIPAddr });

      await pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray);

      expect(waitUntilUsedOnHost).toBeCalledWith(
        COURIER_PORT,
        mockGatewayIPAddr,
        expect.anything(),
        expect.anything(),
      );
      expect(waitUntilUsedOnHost).toBeCalledWith(
        COURIER_PORT,
        newGatewayIPAddr,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('Pings', () => {
    test('Initial status should be CONNECTED if courier netloc is used', async () => {
      await expect(
        pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.CONNECTED]);
    });

    test('Status should remain CONNECTED if courier netloc was previously used', async () => {
      getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);
      getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);
      getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.CONNECTED, CourierConnectionStatus.DISCONNECTED]);
    });

    test('Initial status should be DISCONNECTED if courier netloc is not used', async () => {
      getMockInstance(waitUntilUsedOnHost).mockRejectedValue(new Error('disconnected'));

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.DISCONNECTED]);
    });

    test('Status should remain DISCONNECTED if courier netloc was not previously used', async () => {
      getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));
      getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));
      getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.DISCONNECTED, CourierConnectionStatus.CONNECTED]);
    });

    test('Status should change to CONNECTED if courier was previously DISCONNECTED', async () => {
      getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));
      getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.DISCONNECTED, CourierConnectionStatus.CONNECTED]);
    });

    test('Status should change to DISCONNECTED if courier was previously CONNECTED', async () => {
      getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);
      getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.CONNECTED, CourierConnectionStatus.DISCONNECTED]);
    });
  });
});
