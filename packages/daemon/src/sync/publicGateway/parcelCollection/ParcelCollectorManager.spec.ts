import pipe from 'it-pipe';
import { PassThrough } from 'stream';
import { Container } from 'typedi';

import { asyncIterableToArray, iterableTake } from '../../../testUtils/iterables';
import { mockSpy } from '../../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../../testUtils/logging';
import { makeStubPassThrough } from '../../../testUtils/stream';
import { LOGGER } from '../../../tokens';
import * as child from '../../../utils/subprocess/child';
import { PublicGatewayCollectionStatus } from '../PublicGatewayCollectionStatus';
import { ParcelCollectorManager } from './ParcelCollectorManager';

const getSubprocessStream = makeStubPassThrough();
const mockFork = mockSpy(jest.spyOn(child, 'fork'), getSubprocessStream);

const mockLogs = mockLoggerToken();

let manager: ParcelCollectorManager;
beforeEach(() => {
  manager = new ParcelCollectorManager(Container.get(LOGGER));
});

describe('start', () => {
  test('Subprocess parcel-collection should be started', async () => {
    await manager.start();

    expect(mockFork).toBeCalledWith('parcel-collection');
    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Started parcel collection subprocess'));
  });

  test('Subprocess should not be started if it is already running', async () => {
    await manager.start();
    await manager.start();

    expect(mockFork).toBeCalledTimes(1);
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Ignored attempt to start parcel collection subprocess a second time'),
    );
  });
});

describe('restart', () => {
  test('Process should be killed and then started if it is already running', async () => {
    const subprocess1 = new PassThrough({ objectMode: true });
    mockFork.mockResolvedValueOnce(subprocess1);
    const subprocess2 = new PassThrough({ objectMode: true });
    mockFork.mockResolvedValueOnce(subprocess2);
    await manager.start();

    await manager.restart();

    expect(mockFork).toBeCalledTimes(2);
    expect(subprocess1.destroyed).toBeTrue();
    expect(subprocess2.destroyed).toBeFalse();
  });

  test('Process should be started if it was not already running', async () => {
    const startSpy = jest.spyOn(manager, 'start');

    await manager.restart();

    expect(startSpy).toBeCalledTimes(1);
    expect(getSubprocessStream().destroyed).toBeFalse();
  });
});

describe('streamStatus', () => {
  test('Error should be thrown if subprocess has not been started', async () => {
    await expect(asyncIterableToArray(manager.streamStatus())).rejects.toHaveProperty(
      'message',
      'Parcel collection subprocess is not yet running',
    );
  });

  test('DISCONNECTED should be returned if subprocess reports disconnection', async () => {
    await manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ type: 'status', status: 'disconnected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.DISCONNECTED]);
  });

  test('CONNECTED should be returned if subprocess reports connection', async () => {
    await manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });

  test('Subsequent connection changes should be reflected', async () => {
    await manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ type: 'status', status: 'connected' });
      getSubprocessStream().write({ type: 'status', status: 'disconnected' });
      getSubprocessStream().write({ type: 'status', status: 'connected' });
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
    await manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ foo: 'bar' });
      getSubprocessStream().write({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });

  test('Non-connection messages should be ignored', async () => {
    await manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ type: 'invalid' });
      getSubprocessStream().write({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });

  test('Breaking the iterable should not destroy the underlying stream', async () => {
    await manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ type: 'status', status: 'connected' });
    });

    await pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray);

    expect(getSubprocessStream().destroyed).toBeFalse();
    expect(getSubprocessStream().listenerCount('data')).toEqual(0);
  });

  test('New stream should be picked up when subprocess is restarted', async () => {
    const subprocess1 = new PassThrough({ objectMode: true });
    mockFork.mockResolvedValueOnce(subprocess1);
    const subprocess2 = new PassThrough({ objectMode: true });
    mockFork.mockResolvedValueOnce(subprocess2);
    await manager.start();

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
