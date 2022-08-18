import pipe from 'it-pipe';
import { PassThrough } from 'stream';
import { Container } from 'typedi';

import { asyncIterableToArray, iterableTake } from '../../../testUtils/iterables';
import { getMockInstance } from '../../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../../testUtils/logging';
import { mockFork } from '../../../testUtils/subprocess';
import { setImmediateAsync } from '../../../testUtils/timing';
import { LOGGER } from '../../../tokens';
import { fork } from '../../../utils/subprocess/child';
import { InternetGatewayCollectionStatus } from '../InternetGatewayCollectionStatus';
import { ParcelCollectionNotification, ParcelCollectorMessage } from './messaging';
import { ParcelCollectorManager } from './ParcelCollectorManager';

const mockLogs = mockLoggerToken();

let manager: ParcelCollectorManager;
beforeEach(() => {
  manager = new ParcelCollectorManager(Container.get(LOGGER));
});

const getSubprocess = mockFork();

describe('start', () => {
  test('Subprocess parcel-collection should be started', async () => {
    await manager.start();

    expect(fork).toBeCalledWith('parcel-collection');
    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Started parcel collection subprocess'));
  });

  test('Subprocess should not be started if it is already running', async () => {
    await manager.start();
    await manager.start();

    expect(fork).toBeCalledTimes(1);
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Ignored attempt to start parcel collection subprocess a second time'),
    );
  });
});

describe('restart', () => {
  test('Process should be killed and then started if it is already running', async () => {
    const subprocess1 = new PassThrough({ objectMode: true });
    getMockInstance(fork).mockReturnValueOnce(subprocess1);
    const subprocess2 = new PassThrough({ objectMode: true });
    getMockInstance(fork).mockReturnValueOnce(subprocess2);
    await manager.start();

    await manager.restart();

    expect(fork).toBeCalledTimes(2);
    expect(subprocess1.destroyed).toBeTrue();
    expect(subprocess2.destroyed).toBeFalse();
  });

  test('Nothing should happen if subprocess was not already running', async () => {
    const startSpy = jest.spyOn(manager, 'start');

    await manager.restart();

    expect(startSpy).not.toBeCalled();
  });

  test('Nothing should happen if subprocess is undergoing a restart', async () => {
    await manager.start();

    // Mimic a restart
    getSubprocess().destroy();
    await setImmediateAsync();

    await manager.restart();

    expect(fork).toBeCalledTimes(1);
  });
});

describe('streamStatus', () => {
  test('It should wait for subprocess to start if it is not already running', async () => {
    setImmediate(async () => {
      await manager.start();
      emitValidSubprocessMessage({ type: 'status', status: 'disconnected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([InternetGatewayCollectionStatus.DISCONNECTED]);
  });

  test('DISCONNECTED should be returned if subprocess reports disconnection', async () => {
    await manager.start();
    setImmediate(() => {
      emitValidSubprocessMessage({ type: 'status', status: 'disconnected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([InternetGatewayCollectionStatus.DISCONNECTED]);
  });

  test('CONNECTED should be returned if subprocess reports connection', async () => {
    await manager.start();
    setImmediate(() => {
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([InternetGatewayCollectionStatus.CONNECTED]);
  });

  test('Subsequent connection changes should be reflected', async () => {
    await manager.start();
    setImmediate(() => {
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
      emitValidSubprocessMessage({ type: 'status', status: 'disconnected' });
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(3), asyncIterableToArray),
    ).resolves.toEqual([
      InternetGatewayCollectionStatus.CONNECTED,
      InternetGatewayCollectionStatus.DISCONNECTED,
      InternetGatewayCollectionStatus.CONNECTED,
    ]);
  });

  test('Messages without types should be ignored', async () => {
    await manager.start();
    setImmediate(() => {
      getSubprocess().write({ foo: 'bar' });
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([InternetGatewayCollectionStatus.CONNECTED]);
  });

  test('Non-connection messages should be ignored', async () => {
    await manager.start();
    setImmediate(() => {
      emitValidSubprocessMessage({
        parcelKey: 'key',
        recipientAddress: 'recipient',
        type: 'parcelCollection',
      });
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([InternetGatewayCollectionStatus.CONNECTED]);
  });

  test('Breaking the iterable should not destroy the underlying stream', async () => {
    await manager.start();
    setImmediate(() => {
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
    });

    await pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray);

    const subprocess = getSubprocess();
    expect(subprocess.destroyed).toBeFalse();
    expect(subprocess.listenerCount('data')).toEqual(0);
  });

  test('Status should continue to be streamed across restarts', async () => {
    const subprocess1 = new PassThrough({ objectMode: true });
    getMockInstance(fork).mockReturnValueOnce(subprocess1);
    const subprocess2 = new PassThrough({ objectMode: true });
    getMockInstance(fork).mockReturnValueOnce(subprocess2);
    await manager.start();

    setImmediate(async () => {
      subprocess1.write({ type: 'status', status: 'disconnected' });
      await manager.restart();
      subprocess2.write({ type: 'status', status: 'connected' });
    });
    await expect(
      pipe(manager.streamStatus(), iterableTake(2), asyncIterableToArray),
    ).resolves.toEqual([
      InternetGatewayCollectionStatus.DISCONNECTED,
      InternetGatewayCollectionStatus.CONNECTED,
    ]);
  });
});

describe('watchCollectionsForRecipients', () => {
  const RECIPIENT_ADDRESS = '0deadbeef';

  const PARCEL_KEY = 'the-parcel-key';

  test('It should wait for subprocess to start if it is not already running', async () => {
    setImmediate(async () => {
      await manager.start();
      const status: ParcelCollectionNotification = {
        parcelKey: PARCEL_KEY,
        recipientAddress: RECIPIENT_ADDRESS,
        type: 'parcelCollection',
      };
      emitValidSubprocessMessage(status);
    });

    await expect(
      pipe(
        manager.watchCollectionsForRecipients([RECIPIENT_ADDRESS]),
        iterableTake(1),
        asyncIterableToArray,
      ),
    ).resolves.toEqual([PARCEL_KEY]);
  });

  test('Parcel bound for specified recipient should be output', async () => {
    await manager.start();
    setImmediate(async () => {
      emitValidSubprocessMessage({
        parcelKey: PARCEL_KEY,
        recipientAddress: RECIPIENT_ADDRESS,
        type: 'parcelCollection',
      });
    });

    await expect(
      pipe(
        manager.watchCollectionsForRecipients([RECIPIENT_ADDRESS]),
        iterableTake(1),
        asyncIterableToArray,
      ),
    ).resolves.toEqual([PARCEL_KEY]);
  });

  test('Multiple recipients can be specified', async () => {
    await manager.start();
    const recipient2Address = '0deadc0de';
    const parcel2Key = 'another parcel';
    setImmediate(async () => {
      emitValidSubprocessMessage({
        parcelKey: PARCEL_KEY,
        recipientAddress: RECIPIENT_ADDRESS,
        type: 'parcelCollection',
      });
      emitValidSubprocessMessage({
        parcelKey: parcel2Key,
        recipientAddress: recipient2Address,
        type: 'parcelCollection',
      });
    });

    await expect(
      pipe(
        manager.watchCollectionsForRecipients([RECIPIENT_ADDRESS, recipient2Address]),
        iterableTake(2),
        asyncIterableToArray,
      ),
    ).resolves.toEqual([PARCEL_KEY, parcel2Key]);
  });

  test('Parcel bound for unspecified recipient should be ignored', async () => {
    await manager.start();
    setImmediate(async () => {
      emitValidSubprocessMessage({
        parcelKey: 'the parcel key',
        recipientAddress: 'invalid recipient',
        type: 'parcelCollection',
      });
      emitValidSubprocessMessage({
        parcelKey: PARCEL_KEY,
        recipientAddress: RECIPIENT_ADDRESS,
        type: 'parcelCollection',
      });
    });

    await expect(
      pipe(
        manager.watchCollectionsForRecipients([RECIPIENT_ADDRESS]),
        iterableTake(1),
        asyncIterableToArray,
      ),
    ).resolves.toEqual([PARCEL_KEY]);
  });

  test('Messages without types should be ignored', async () => {
    await manager.start();
    setImmediate(async () => {
      getSubprocess().write({ foo: 'bar' });
      emitValidSubprocessMessage({
        parcelKey: PARCEL_KEY,
        recipientAddress: RECIPIENT_ADDRESS,
        type: 'parcelCollection',
      });
    });

    await expect(
      pipe(
        manager.watchCollectionsForRecipients([RECIPIENT_ADDRESS]),
        iterableTake(1),
        asyncIterableToArray,
      ),
    ).resolves.toEqual([PARCEL_KEY]);
  });

  test('Non-collection messages should be ignored', async () => {
    await manager.start();
    setImmediate(async () => {
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
      emitValidSubprocessMessage({
        parcelKey: PARCEL_KEY,
        recipientAddress: RECIPIENT_ADDRESS,
        type: 'parcelCollection',
      });
    });

    await expect(
      pipe(
        manager.watchCollectionsForRecipients([RECIPIENT_ADDRESS]),
        iterableTake(1),
        asyncIterableToArray,
      ),
    ).resolves.toEqual([PARCEL_KEY]);
  });

  test('Breaking the iterable should not destroy the underlying stream', async () => {
    await manager.start();
    setImmediate(() => {
      emitValidSubprocessMessage({
        parcelKey: PARCEL_KEY,
        recipientAddress: RECIPIENT_ADDRESS,
        type: 'parcelCollection',
      });
    });

    await pipe(
      manager.watchCollectionsForRecipients([RECIPIENT_ADDRESS]),
      iterableTake(1),
      asyncIterableToArray,
    );

    expect(getSubprocess().destroyed).toBeFalse();
    expect(getSubprocess().listenerCount('data')).toEqual(0);
  });

  test('New collections should be reported after subprocess is restarted', async () => {
    const subprocess1 = new PassThrough({ objectMode: true });
    getMockInstance(fork).mockReturnValueOnce(subprocess1);
    const subprocess2 = new PassThrough({ objectMode: true });
    getMockInstance(fork).mockReturnValueOnce(subprocess2);
    await manager.start();
    const parcel2Key = 'another parcel';

    setImmediate(async () => {
      subprocess1.write({
        parcelKey: PARCEL_KEY,
        recipientAddress: RECIPIENT_ADDRESS,
        type: 'parcelCollection',
      });
      await manager.restart();
      subprocess2.write({
        parcelKey: parcel2Key,
        recipientAddress: RECIPIENT_ADDRESS,
        type: 'parcelCollection',
      });
    });
    await expect(
      pipe(
        manager.watchCollectionsForRecipients([RECIPIENT_ADDRESS]),
        iterableTake(2),
        asyncIterableToArray,
      ),
    ).resolves.toEqual([PARCEL_KEY, parcel2Key]);
  });
});

function emitValidSubprocessMessage(message: ParcelCollectorMessage): void {
  getSubprocess().write(message);
}
