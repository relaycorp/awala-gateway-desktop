import { v4 } from 'default-gateway';
import pipe from 'it-pipe';
import { waitUntilUsedOnHost } from 'tcp-port-used';
import { Container } from 'typedi';

import { COURIER_PORT, CourierConnectionStatus, CourierSyncExitCode, CourierSyncStage } from '.';
import { Config } from '../../Config';
import { UnregisteredGatewayError } from '../../errors';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../testUtils/db';
import { asyncIterableToArray, iterableTake } from '../../testUtils/iterables';
import { getMockInstance } from '../../testUtils/jest';
import { getPromiseRejection } from '../../testUtils/promises';
import { mockFork } from '../../testUtils/subprocess';
import { setImmediateAsync } from '../../testUtils/timing';
import { SubprocessError } from '../../utils/subprocess/SubprocessError';
import { GatewayRegistrar } from '../publicGateway/GatewayRegistrar';
import { CourierSyncManager } from './CourierSyncManager';
import { DisconnectedFromCourierError } from './errors';
import { CourierSyncStageNotification } from './messaging';

jest.mock('default-gateway', () => ({ v4: jest.fn() }));
const mockGatewayIPAddr = '192.168.0.12';
beforeEach(() => {
  getMockInstance(v4).mockRestore();
  getMockInstance(v4).mockResolvedValue({ gateway: mockGatewayIPAddr });
});

jest.mock('tcp-port-used', () => ({ waitUntilUsedOnHost: jest.fn() }));

setUpTestDBConnection();
useTemporaryAppDirs();

let courierSync: CourierSyncManager;
beforeEach(() => {
  courierSync = new CourierSyncManager(Container.get(GatewayRegistrar), Container.get(Config));
});

describe('sync', () => {
  const getSubprocessStream = mockFork();

  test('Error should be thrown if private gateway is unregistered', async () => {
    setImmediate(() => {
      getSubprocessStream().destroy(
        new SubprocessError('whoops', CourierSyncExitCode.UNREGISTERED_GATEWAY),
      );
    });

    const syncError = await getPromiseRejection(
      asyncIterableToArray(courierSync.sync()),
      UnregisteredGatewayError,
    );

    expect(syncError.message).toEqual('Private gateway is unregistered');
  });

  test('Error should be thrown if sync fails', async () => {
    const error = new SubprocessError('whoops', CourierSyncExitCode.FAILED_SYNC);
    setImmediate(() => {
      getSubprocessStream().destroy(error);
    });

    const syncError = await getPromiseRejection(
      asyncIterableToArray(courierSync.sync()),
      DisconnectedFromCourierError,
    );

    expect(syncError.message).toMatch(/^Courier sync failed:/);
    expect(syncError.cause()).toEqual(error);
  });

  test('Error should be thrown if unexpected error occurs', async () => {
    const error = new Error('whoops');
    setImmediate(() => {
      getSubprocessStream().destroy(error);
    });

    const syncError = await getPromiseRejection(
      asyncIterableToArray(courierSync.sync()),
      DisconnectedFromCourierError,
    );

    expect(syncError.message).toMatch(/^Courier sync failed:/);
    expect(syncError.cause()).toEqual(error);
  });

  test('Valid notifications from subprocess should be yielded', async () => {
    const subprocessStream = getSubprocessStream();
    setImmediate(async () => {
      subprocessStream.write({ stage: CourierSyncStage.COLLECTION, type: 'stage' });
      subprocessStream.write({ stage: CourierSyncStage.DELIVERY, type: 'stage' });
      subprocessStream.write({ stage: CourierSyncStage.WAIT, type: 'stage' });
      await setImmediateAsync();
      subprocessStream.destroy();
    });

    await expect(pipe(courierSync.sync(), asyncIterableToArray)).resolves.toEqual([
      CourierSyncStage.COLLECTION,
      CourierSyncStage.DELIVERY,
      CourierSyncStage.WAIT,
    ]);
  });

  test('Unrelated messages from subprocess should be ignored', async () => {
    const subprocessStream = getSubprocessStream();
    setImmediate(async () => {
      subprocessStream.write({ type: 'foo' });

      const validNotification: CourierSyncStageNotification = {
        stage: CourierSyncStage.DELIVERY,
        type: 'stage',
      };
      subprocessStream.write(validNotification);

      await setImmediateAsync();
      subprocessStream.destroy();
    });

    await expect(pipe(courierSync.sync(), asyncIterableToArray)).resolves.toEqual([
      CourierSyncStage.DELIVERY,
    ]);
  });

  test('Invalid stage notification should be ignored', async () => {
    const subprocessStream = getSubprocessStream();
    setImmediate(async () => {
      const invalidNotification: CourierSyncStageNotification = {
        stage: 'getting ready' as any,
        type: 'stage',
      };
      subprocessStream.write(invalidNotification);

      const validNotification: CourierSyncStageNotification = {
        stage: CourierSyncStage.DELIVERY,
        type: 'stage',
      };
      subprocessStream.write(validNotification);

      await setImmediateAsync();
      subprocessStream.destroy();
    });

    await expect(pipe(courierSync.sync(), asyncIterableToArray)).resolves.toEqual([
      CourierSyncStage.DELIVERY,
    ]);
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
