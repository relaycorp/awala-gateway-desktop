import { v4 as getDefaultGateway } from 'default-gateway';
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
import { mockSleepSeconds, setImmediateAsync } from '../../testUtils/timing';
import { SubprocessExitError } from '../../utils/subprocess/errors';
import { GatewayRegistrar } from '../internetGateway/GatewayRegistrar';
import { CourierSyncManager } from './CourierSyncManager';
import { DisconnectedFromCourierError } from './errors';
import { CourierSyncStageNotification, ParcelCollectionNotification } from './messaging';
import { mockLoggerToken } from '../../testUtils/logging';

jest.mock('default-gateway', () => ({ v4: jest.fn() }));
const mockGatewayIPAddress = '192.168.0.12';
beforeEach(() => {
  getMockInstance(getDefaultGateway).mockRestore();
  getMockInstance(getDefaultGateway).mockResolvedValue({ gateway: mockGatewayIPAddress });
});

jest.mock('tcp-port-used', () => ({ waitUntilUsedOnHost: jest.fn() }));

setUpTestDBConnection();
useTemporaryAppDirs();
mockLoggerToken();

let courierSync: CourierSyncManager;
beforeEach(() => {
  courierSync = new CourierSyncManager(Container.get(GatewayRegistrar), Container.get(Config));
});

const getSubprocess = mockFork();

describe('sync', () => {
  test('Error should be thrown if private gateway is unregistered', async () => {
    setImmediate(() => {
      getSubprocess().destroy(
        new SubprocessExitError('whoops', CourierSyncExitCode.UNREGISTERED_GATEWAY),
      );
    });

    const syncError = await getPromiseRejection(
      asyncIterableToArray(courierSync.sync()),
      UnregisteredGatewayError,
    );

    expect(syncError.message).toEqual('Private gateway is unregistered');
  });

  test('Error should be thrown if sync fails', async () => {
    const error = new SubprocessExitError('whoops', CourierSyncExitCode.FAILED_SYNC);
    setImmediate(() => {
      getSubprocess().destroy(error);
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
      getSubprocess().destroy(error);
    });

    const syncError = await getPromiseRejection(
      asyncIterableToArray(courierSync.sync()),
      DisconnectedFromCourierError,
    );

    expect(syncError.message).toMatch(/^Courier sync failed:/);
    expect(syncError.cause()).toEqual(error);
  });

  test('Valid notifications from subprocess should be yielded', async () => {
    const subprocessStream = getSubprocess();
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
    const subprocessStream = getSubprocess();
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
    const subprocessStream = getSubprocess();
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

  const sleepSecondsMock = mockSleepSeconds();

  test('Failure to get default gateway should be skip ping', async () => {
    getMockInstance(getDefaultGateway).mockRejectedValue(
      new Error('Device is not connected to any network'),
    );

    await pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray);

    expect(waitUntilUsedOnHost).not.toBeCalled();
  });

  test('Default gateway should be pinged on port 21473', async () => {
    await pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray);

    expect(waitUntilUsedOnHost).toBeCalledWith(COURIER_PORT, mockGatewayIPAddress, 500, 3_000);
  });

  test('Any change to the default gateway should be reflected in pings', async () => {
    getMockInstance(getDefaultGateway).mockRestore();
    getMockInstance(getDefaultGateway).mockResolvedValueOnce({ gateway: mockGatewayIPAddress });
    const newGatewayIPAddr = `${mockGatewayIPAddress}1`;
    getMockInstance(getDefaultGateway).mockResolvedValueOnce({ gateway: newGatewayIPAddr });

    await pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray);

    expect(waitUntilUsedOnHost).toBeCalledWith(
      COURIER_PORT,
      mockGatewayIPAddress,
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

  test('Initial status should be CONNECTED if courier port is used', async () => {
    await expect(
      pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([CourierConnectionStatus.CONNECTED]);
  });

  test('Status should remain CONNECTED if courier port was previously used', async () => {
    getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);
    getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);
    getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));

    await expect(
      pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray),
    ).resolves.toEqual([CourierConnectionStatus.CONNECTED, CourierConnectionStatus.DISCONNECTED]);
  });

  test('Initial status should be DISCONNECTED if courier port is not used', async () => {
    getMockInstance(waitUntilUsedOnHost).mockRejectedValue(new Error('disconnected'));

    await expect(
      pipe(courierSync.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([CourierConnectionStatus.DISCONNECTED]);
  });

  test('Status should remain DISCONNECTED if courier port was not previously used', async () => {
    getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));
    getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));
    getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);

    await expect(
      pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray),
    ).resolves.toEqual([CourierConnectionStatus.DISCONNECTED, CourierConnectionStatus.CONNECTED]);
  });

  test('It should allow 2 seconds between pings', async () => {
    getMockInstance(waitUntilUsedOnHost).mockResolvedValueOnce(undefined);
    getMockInstance(waitUntilUsedOnHost).mockRejectedValueOnce(new Error('disconnected'));

    await pipe(courierSync.streamStatus(), iterableTake(2), asyncIterableToArray);

    expect(sleepSecondsMock).toHaveBeenCalledTimes(1);
    expect(sleepSecondsMock).toHaveBeenCalledWith(2);
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

describe('streamCollectedParcelKeys', () => {
  const RECIPIENT_ADDRESS = 'the recipient';

  test('Keys for collected parcels should be output', async () => {
    const subprocess = getSubprocess();
    const parcel1Key = 'parcel1';
    const parcel2Key = 'parcel2';
    setImmediate(async () => {
      notifyParcelCollection(parcel1Key, RECIPIENT_ADDRESS);
      notifyParcelCollection(parcel2Key, RECIPIENT_ADDRESS);
      await setImmediateAsync();
      subprocess.destroy();
    });

    const [, parcelKeys] = await Promise.all([
      asyncIterableToArray(courierSync.sync()),
      pipe(
        courierSync.streamCollectedParcelKeys([RECIPIENT_ADDRESS]),
        iterableTake(2),
        asyncIterableToArray,
      ),
    ]);

    expect(parcelKeys).toEqual([parcel1Key, parcel2Key]);
  });

  test('Parcels bound for a different recipient should be ignored', async () => {
    const subprocess = getSubprocess();
    const parcelKey = 'parcel1';
    setImmediate(async () => {
      // Send the irrelevant one first to ensure it's ignored
      notifyParcelCollection(`not ${parcelKey}`, `not ${RECIPIENT_ADDRESS}`);
      notifyParcelCollection(parcelKey, RECIPIENT_ADDRESS);
      await setImmediateAsync();
      subprocess.destroy();
    });

    const [, parcelKeys] = await Promise.all([
      asyncIterableToArray(courierSync.sync()),
      pipe(
        courierSync.streamCollectedParcelKeys([RECIPIENT_ADDRESS]),
        iterableTake(1),
        asyncIterableToArray,
      ),
    ]);

    expect(parcelKeys).toEqual([parcelKey]);
  });

  test('Iterable should be usable in parallel', async () => {
    const subprocess = getSubprocess();
    const parcel1Key = 'parcel1';
    const parcel2Key = 'parcel2';
    setImmediate(async () => {
      notifyParcelCollection(parcel1Key, RECIPIENT_ADDRESS);
      notifyParcelCollection(parcel2Key, RECIPIENT_ADDRESS);
      await setImmediateAsync();
      subprocess.destroy();
    });

    const stream1 = courierSync.streamCollectedParcelKeys([RECIPIENT_ADDRESS]);
    const stream2 = courierSync.streamCollectedParcelKeys([RECIPIENT_ADDRESS]);
    const [, result1, result2] = await Promise.all([
      asyncIterableToArray(courierSync.sync()),
      pipe(stream1, iterableTake(1), asyncIterableToArray),
      pipe(stream2, iterableTake(2), asyncIterableToArray),
    ]);

    expect(result1).toEqual([parcel1Key]);
    expect(result2).toEqual([parcel1Key, parcel2Key]);
  });

  test('Subprocess should not be terminated when breaking out of iterable', async () => {
    const subprocess = getSubprocess();
    setImmediate(async () => {
      notifyParcelCollection('parcel 1', RECIPIENT_ADDRESS);
      notifyParcelCollection('parcel 2', RECIPIENT_ADDRESS);
    });

    const sync = asyncIterableToArray(courierSync.sync());
    await pipe(
      courierSync.streamCollectedParcelKeys([RECIPIENT_ADDRESS]),
      iterableTake(1),
      asyncIterableToArray,
    );

    expect(subprocess.destroyed).toBeFalse();
    subprocess.destroy();
    await sync;
  });

  function notifyParcelCollection(parcelKey: string, recipientId: string): void {
    const notification: ParcelCollectionNotification = {
      parcelKey,
      recipientId,
      type: 'parcelCollection',
    };
    const subprocess = getSubprocess();
    subprocess.write(notification);
  }
});
