import pipe from 'it-pipe';
import { PassThrough } from 'stream';
import { Container } from 'typedi';

import { asyncIterableToArray, iterableTake } from '../../../testUtils/iterables';
import { mockSpy } from '../../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../../testUtils/logging';
import { makeStubPassThrough } from '../../../testUtils/stream';
import { setImmediateAsync } from '../../../testUtils/timing';
import { LOGGER } from '../../../tokens';
import * as child from '../../../utils/subprocess/child';
import { PublicGatewayCollectionStatus } from '../PublicGatewayCollectionStatus';
import { ParcelCollectionNotification, ParcelCollectorMessage } from './messaging';
import { ParcelCollectorManager } from './ParcelCollectorManager';

const getSubprocessStream = makeStubPassThrough();
const mockFork = mockSpy(jest.spyOn(child, 'fork'), getSubprocessStream);

const mockLogs = mockLoggerToken();

let manager: ParcelCollectorManager;
beforeEach(() => {
  manager = new ParcelCollectorManager(Container.get(LOGGER));
});

describe('start', () => {
  test('Subprocess parcel-collection should be started', () => {
    manager.start();

    expect(mockFork).toBeCalledWith('parcel-collection');
    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Started parcel collection subprocess'));
  });

  test('Subprocess should not be started if it is already running', () => {
    manager.start();
    manager.start();

    expect(mockFork).toBeCalledTimes(1);
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Ignored attempt to start parcel collection subprocess a second time'),
    );
  });
});

describe('restart', () => {
  test('Process should be killed and then started if it is already running', async () => {
    const subprocess1 = new PassThrough({ objectMode: true });
    mockFork.mockReturnValueOnce(subprocess1);
    const subprocess2 = new PassThrough({ objectMode: true });
    mockFork.mockReturnValueOnce(subprocess2);
    manager.start();

    await manager.restart();

    expect(mockFork).toBeCalledTimes(2);
    expect(subprocess1.destroyed).toBeTrue();
    expect(subprocess2.destroyed).toBeFalse();
  });

  test('Nothing should happen if subprocess was not already running', async () => {
    const startSpy = jest.spyOn(manager, 'start');

    await manager.restart();

    expect(startSpy).not.toBeCalled();
  });

  test('Nothing should happen if subprocess is undergoing a restart', async () => {
    manager.start();

    // Mimic a restart
    getSubprocessStream().destroy();
    await setImmediateAsync();

    await manager.restart();

    expect(mockFork).toBeCalledTimes(1);
  });
});

describe('streamStatus', () => {
  test('It should wait for subprocess to start if it is not already running', async () => {
    setImmediate(async () => {
      manager.start();
      emitValidSubprocessMessage({ type: 'status', status: 'disconnected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.DISCONNECTED]);
  });

  test('DISCONNECTED should be returned if subprocess reports disconnection', async () => {
    manager.start();
    setImmediate(() => {
      emitValidSubprocessMessage({ type: 'status', status: 'disconnected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.DISCONNECTED]);
  });

  test('CONNECTED should be returned if subprocess reports connection', async () => {
    manager.start();
    setImmediate(() => {
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });

  test('Subsequent connection changes should be reflected', async () => {
    manager.start();
    setImmediate(() => {
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
      emitValidSubprocessMessage({ type: 'status', status: 'disconnected' });
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(3), asyncIterableToArray),
    ).resolves.toEqual([
      PublicGatewayCollectionStatus.CONNECTED,
      PublicGatewayCollectionStatus.DISCONNECTED,
      PublicGatewayCollectionStatus.CONNECTED,
    ]);
  });

  test('Messages without types should be ignored', async () => {
    manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ foo: 'bar' });
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });

  test('Non-connection messages should be ignored', async () => {
    manager.start();
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
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });

  test('Breaking the iterable should not destroy the underlying stream', async () => {
    manager.start();
    setImmediate(() => {
      emitValidSubprocessMessage({ type: 'status', status: 'connected' });
    });

    await pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray);

    expect(getSubprocessStream().destroyed).toBeFalse();
    expect(getSubprocessStream().listenerCount('data')).toEqual(0);
  });

  test('Status should continue to be streamed across restarts', async () => {
    const subprocess1 = new PassThrough({ objectMode: true });
    mockFork.mockReturnValueOnce(subprocess1);
    const subprocess2 = new PassThrough({ objectMode: true });
    mockFork.mockReturnValueOnce(subprocess2);
    manager.start();

    setImmediate(async () => {
      subprocess1.write({ type: 'status', status: 'disconnected' });
      await manager.restart();
      subprocess2.write({ type: 'status', status: 'connected' });
    });
    await expect(
      pipe(manager.streamStatus(), iterableTake(2), asyncIterableToArray),
    ).resolves.toEqual([
      PublicGatewayCollectionStatus.DISCONNECTED,
      PublicGatewayCollectionStatus.CONNECTED,
    ]);
  });
});

describe('watchCollectionsForRecipients', () => {
  const RECIPIENT_ADDRESS = '0deadbeef';

  const PARCEL_KEY = 'the-parcel-key';

  test('It should wait for subprocess to start if it is not already running', async () => {
    setImmediate(async () => {
      manager.start();
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
    manager.start();
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
    manager.start();
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
    manager.start();
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
    manager.start();
    setImmediate(async () => {
      getSubprocessStream().write({ foo: 'bar' });
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
    manager.start();
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
    manager.start();
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

    expect(getSubprocessStream().destroyed).toBeFalse();
    expect(getSubprocessStream().listenerCount('data')).toEqual(0);
  });

  test('New collections should be reported after subprocess is restarted', async () => {
    const subprocess1 = new PassThrough({ objectMode: true });
    mockFork.mockReturnValueOnce(subprocess1);
    const subprocess2 = new PassThrough({ objectMode: true });
    mockFork.mockReturnValueOnce(subprocess2);
    manager.start();
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
  getSubprocessStream().write(message);
}
