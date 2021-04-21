import pipe from 'it-pipe';
import { Container } from 'typedi';

import { useTemporaryAppDirs } from '../testUtils/appDirs';
import { setUpTestDBConnection } from '../testUtils/db';
import { arrayToAsyncIterable, asyncIterableToArray, iterableTake } from '../testUtils/iterables';
import { mockSpy } from '../testUtils/jest';
import { setImmediateAsync } from '../testUtils/timers';
import { CourierConnectionStatus, CourierSync } from './courierSync/CourierSync';
import { GatewayRegistrar } from './publicGateway/GatewayRegistrar';
import { ConnectionStatus, StatusMonitor } from './StatusMonitor';

setUpTestDBConnection();
useTemporaryAppDirs();

let monitor: StatusMonitor;
beforeEach(() => {
  monitor = new StatusMonitor(Container.get(CourierSync), Container.get(GatewayRegistrar));
});

describe('start', () => {
  const mockRegistrarIsRegistered = mockSpy(
    jest.spyOn(GatewayRegistrar.prototype, 'isRegistered'),
    () => true,
  );
  const mockCourierStatusStream = mockSpy(jest.spyOn(CourierSync.prototype, 'streamStatus'));

  describe('While gateway is unregistered', () => {
    test('Initial status should be DISCONNECTED', async () => {
      mockCourierStatusStream.mockReturnValue(arrayToAsyncIterable([]));

      await monitor.start();

      const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);
      expect(statuses).toEqual([ConnectionStatus.DISCONNECTED]);
    });

    test('Status should change to CONNECTED_TO_COURIER when courier is reachable', async () => {
      mockCourierStatusStream.mockReturnValue(
        arrayToAsyncIterable([CourierConnectionStatus.CONNECTED]),
      );

      await monitor.start();

      const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);
      expect(statuses).toEqual([ConnectionStatus.CONNECTED_TO_COURIER]);
    });

    test('Status should change to DISCONNECTED when courier is not reachable', async () => {
      mockCourierStatusStream.mockReturnValue(
        arrayToAsyncIterable([CourierConnectionStatus.DISCONNECTED]),
      );

      await monitor.start();

      const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);
      expect(statuses).toEqual([ConnectionStatus.DISCONNECTED]);
    });

    test('Subsequent changes to courier connection status should be reflected', async () => {
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
      mockCourierStatusStream.mockReturnValue(arrayToAsyncIterable([]));

      await monitor.start();
      await expect(monitor.start()).toReject();

      expect(mockCourierStatusStream).toBeCalledTimes(1);
    });
  });

  describe('While gateway is unregistered', () => {
    beforeEach(() => {
      mockRegistrarIsRegistered.mockResolvedValue(false);
    });

    test('Initial status should be UNREGISTERED', async () => {
      mockCourierStatusStream.mockReturnValue(arrayToAsyncIterable([]));

      await monitor.start();

      const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);
      expect(statuses).toEqual([ConnectionStatus.UNREGISTERED]);
    });

    test('Status should remain UNREGISTERED regardless of courier connection changes', async () => {
      mockCourierStatusStream.mockReturnValue(
        arrayToAsyncIterable([
          CourierConnectionStatus.CONNECTED,
          CourierConnectionStatus.DISCONNECTED,
        ]),
      );

      await monitor.start();

      setImmediate(() => {
        monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY);
      });
      const statuses = await pipe(monitor.streamStatus(), iterableTake(2), asyncIterableToArray);
      expect(statuses).toEqual([
        ConnectionStatus.UNREGISTERED,
        ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
      ]);
    });
  });
});

describe('streamStatus', () => {
  test('Initial status should be the last known one', async () => {
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);

    const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);

    expect(statuses).toEqual([ConnectionStatus.CONNECTED_TO_COURIER]);
  });

  test('No initial status should be output if there is none', async () => {
    setImmediate(() => {
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY);
    });
    const stream = await pipe(monitor.streamStatus(), iterableTake(1));

    await expect(asyncIterableToArray(stream)).resolves.toEqual([
      ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
    ]);
  });

  test('Subsequent status changes should be output', async () => {
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
    setImmediate(() => {
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY);
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY);
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);
    });
    const stream = await pipe(monitor.streamStatus(), iterableTake(2));

    await expect(asyncIterableToArray(stream)).resolves.toEqual([
      ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
      ConnectionStatus.CONNECTED_TO_COURIER,
    ]);
  });

  test('Previous statuses should be ignored', async () => {
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
