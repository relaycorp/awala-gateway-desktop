import pipe from 'it-pipe';
import { Container } from 'typedi';

import { arrayToAsyncIterable, asyncIterableToArray, iterableTake } from '../testUtils/iterables';
import { mockSpy } from '../testUtils/jest';
import { setImmediateAsync } from '../testUtils/timers';
import { CourierConnectionStatus, CourierSync } from './courierSync/CourierSync';
import { ConnectionStatus, StatusMonitor } from './StatusMonitor';

describe('getLastStatus', () => {
  test('DISCONNECTED should be initial status', () => {
    const monitor = new StatusMonitor(Container.get(CourierSync));

    expect(monitor.getLastStatus()).toEqual(ConnectionStatus.DISCONNECTED);
  });

  test('Last status should be returned if explicitly set', () => {
    const monitor = new StatusMonitor(Container.get(CourierSync));
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);

    expect(monitor.getLastStatus()).toEqual(ConnectionStatus.CONNECTED_TO_COURIER);
  });
});

describe('start', () => {
  const mockCourierStatusStream = mockSpy(jest.spyOn(CourierSync.prototype, 'streamStatus'));

  test('Status should change to CONNECTED_TO_COURIER when courier is reachable', async () => {
    const monitor = new StatusMonitor(Container.get(CourierSync));
    mockCourierStatusStream.mockReturnValue(
      arrayToAsyncIterable([CourierConnectionStatus.CONNECTED]),
    );

    await monitor.start();

    const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);
    expect(statuses).toEqual([ConnectionStatus.CONNECTED_TO_COURIER]);
  });

  test('Status should change to DISCONNECTED when courier is not reachable', async () => {
    const monitor = new StatusMonitor(Container.get(CourierSync));
    mockCourierStatusStream.mockReturnValue(
      arrayToAsyncIterable([CourierConnectionStatus.DISCONNECTED]),
    );

    await monitor.start();

    const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);
    expect(statuses).toEqual([ConnectionStatus.DISCONNECTED]);
  });

  test('Subsequent changes to courier connection status should be reflected', async () => {
    const monitor = new StatusMonitor(Container.get(CourierSync));
    mockCourierStatusStream.mockReturnValue(
      arrayToAsyncIterable([
        CourierConnectionStatus.CONNECTED,
        CourierConnectionStatus.DISCONNECTED,
      ]),
    );

    setImmediate(() => monitor.start());

    const statuses = await pipe(monitor.streamStatus(), iterableTake(3), asyncIterableToArray);
    expect(statuses).toEqual([
      ConnectionStatus.DISCONNECTED,
      ConnectionStatus.CONNECTED_TO_COURIER,
      ConnectionStatus.DISCONNECTED,
    ]);
  });

  test('Subsequent start calls should be ignored', async () => {
    const monitor = new StatusMonitor(Container.get(CourierSync));
    mockCourierStatusStream.mockReturnValue(arrayToAsyncIterable([]));

    await monitor.start();
    await expect(monitor.start()).toReject();

    expect(mockCourierStatusStream).toBeCalledTimes(1);
  });
});

describe('streamStatus', () => {
  test('Initial status should be the last known one', async () => {
    const monitor = new StatusMonitor(Container.get(CourierSync));
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);

    const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);

    expect(statuses).toEqual([ConnectionStatus.CONNECTED_TO_COURIER]);
  });

  test('Subsequent status changes should be output', async () => {
    const monitor = new StatusMonitor(Container.get(CourierSync));
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);
    await setImmediateAsync();

    setImmediate(() => {
      monitor.setLastStatus(ConnectionStatus.DISCONNECTED);
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY);
    });
    const stream = await pipe(monitor.streamStatus(), iterableTake(3));

    await expect(asyncIterableToArray(stream)).resolves.toEqual([
      ConnectionStatus.CONNECTED_TO_COURIER,
      ConnectionStatus.DISCONNECTED,
      ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
    ]);
  });

  test('Consecutive, duplicated statuses should be ignored', async () => {
    const monitor = new StatusMonitor(Container.get(CourierSync));
    await setImmediateAsync();

    setImmediate(() => {
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY);
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY);
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);
    });
    const stream = await pipe(monitor.streamStatus(), iterableTake(3));

    await expect(asyncIterableToArray(stream)).resolves.toEqual([
      ConnectionStatus.DISCONNECTED,
      ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
      ConnectionStatus.CONNECTED_TO_COURIER,
    ]);
  });

  test('Previous statuses should be ignored', async () => {
    const monitor = new StatusMonitor(Container.get(CourierSync));
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY);

    setImmediate(() => {
      monitor.setLastStatus(ConnectionStatus.DISCONNECTED);
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);
    });
    const stream = await monitor.streamStatus();

    await expect(pipe(stream, iterableTake(3), asyncIterableToArray)).resolves.toEqual([
      ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
      ConnectionStatus.DISCONNECTED,
      ConnectionStatus.CONNECTED_TO_COURIER,
    ]);
  });
});
