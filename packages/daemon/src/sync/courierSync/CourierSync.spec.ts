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
