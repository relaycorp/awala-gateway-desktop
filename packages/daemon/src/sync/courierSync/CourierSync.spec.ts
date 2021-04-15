import { v4 } from 'default-gateway';
import pipe from 'it-pipe';
import { waitUntilUsedOnHost } from 'tcp-port-used';

import { asyncIterableToArray, iterableTake } from '../../testUtils/iterables';
import { getMockInstance } from '../../testUtils/jest';
import { COURIER_PORT, CourierConnectionStatus, CourierSync } from './CourierSync';

jest.mock('default-gateway', () => ({ v4: jest.fn() }));
const mockGatewayIPAddr = '192.168.0.12';
beforeEach(() => {
  getMockInstance(v4).mockRestore();
  getMockInstance(v4).mockResolvedValue({ gateway: mockGatewayIPAddr });
});

jest.mock('tcp-port-used', () => ({ waitUntilUsedOnHost: jest.fn() }));
beforeEach(() => {
  getMockInstance(waitUntilUsedOnHost).mockRestore();
});

describe('sync', () => {
  test.todo('Client should connect to port 21473 on the default gateway');

  describe('Cargo collection', () => {
    test.todo('COLLECTION stage should be yielded at the start');

    describe('Cargo Collection Authorization', () => {
      test.todo('Recipient should be paired public gateway if registered');

      test.todo('Recipient should be default public gateway if unregistered');

      test.todo('Start date should be 90 minutes in the past to tolerate clock drift');

      test.todo('Expiry date should be 30 days in the future');

      test.todo('Sender should be self-issued certificate for own key');

      test.todo('Sender certificate chain should be empty');

      describe('Cargo Collection Request', () => {
        test.todo('CDA subject should be paired public gateway if registered');

        test.todo('CDA subject should be default public gateway if unregistered');
      });
    });

    test.todo('Cargo should be stored with no validation');

    test.todo('Incoming cargo processor should be notified about new cargo');

    test.todo('No more than 100 cargoes should be accepted');
  });

  describe('Wait period', () => {
    test.todo('WAIT stage should be yielded at the start');

    test.todo('Client should wait for 5 seconds before delivering cargo');
  });

  describe('Cargo delivery', () => {
    test.todo('DELIVERY stage should be yielded at the start');

    test.todo('Outgoing cargo generator should be started');

    test.todo('Each generated cargo should be delivered');

    test.todo('Delivery should end when outgoing cargo generator completes normally');

    test.todo('Delivery should end when outgoing cargo generator errors out');
  });

  describe('Completion', () => {
    test.todo('Iterator should end when sync completes successfully');

    test.todo('CogRPC client should be closed when sync completes successfully');

    test.todo('CogRPC client should be closed when sync fails');
  });
});

describe('streamStatus', () => {
  describe('Default gateway', () => {
    test('Failure to get default gateway should be quietly ignored', async () => {
      const courierSync = new CourierSync();
      getMockInstance(v4).mockRejectedValue(new Error('Device is not connected to any network'));

      await pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray);

      expect(waitUntilUsedOnHost).not.toBeCalled();
    });

    test('Default gateway should be pinged on port 21473', async () => {
      const courierSync = new CourierSync();

      await pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray);

      expect(waitUntilUsedOnHost).toBeCalledWith(COURIER_PORT, mockGatewayIPAddr, 500, 3_000);
    });

    test('Any change to the default gateway should be picked up', async () => {
      const courierSync = new CourierSync();
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
      const courierSync = new CourierSync();

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.CONNECTED]);
    });

    test('Status should remain CONNECTED if courier netloc was previously used', async () => {
      const courierSync = new CourierSync();
      getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);
      getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);
      getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.CONNECTED, CourierConnectionStatus.DISCONNECTED]);
    });

    test('Initial status should be DISCONNECTED if courier netloc is not used', async () => {
      const courierSync = new CourierSync();
      getMockInstance(waitUntilUsedOnHost).mockRejectedValue(new Error('disconnected'));

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.DISCONNECTED]);
    });

    test('Status should remain DISCONNECTED if courier netloc was not previously used', async () => {
      const courierSync = new CourierSync();
      getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));
      getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));
      getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.DISCONNECTED, CourierConnectionStatus.CONNECTED]);
    });

    test('Status should change to CONNECTED if courier was previously DISCONNECTED', async () => {
      const courierSync = new CourierSync();
      getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));
      getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.DISCONNECTED, CourierConnectionStatus.CONNECTED]);
    });

    test('Status should change to DISCONNECTED if courier was previously CONNECTED', async () => {
      const courierSync = new CourierSync();
      getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);
      getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));

      await expect(
        pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray),
      ).resolves.toEqual([CourierConnectionStatus.CONNECTED, CourierConnectionStatus.DISCONNECTED]);
    });
  });
});
