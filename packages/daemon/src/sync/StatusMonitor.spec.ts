import pipe from 'it-pipe';
import { Container } from 'typedi';

import { useTemporaryAppDirs } from '../testUtils/appDirs';
import { setUpTestDBConnection } from '../testUtils/db';
import { arrayToAsyncIterable, asyncIterableToArray, iterableTake } from '../testUtils/iterables';
import { mockSpy } from '../testUtils/jest';
import { mockLoggerToken } from '../testUtils/logging';
import { setImmediateAsync } from '../testUtils/timing';
import { CourierConnectionStatus, CourierSync } from './courierSync/CourierSync';
import { GatewayRegistrar } from './publicGateway/GatewayRegistrar';
import { ParcelCollectorManager } from './publicGateway/parcelCollection/ParcelCollectorManager';
import { PublicGatewayCollectionStatus } from './publicGateway/PublicGatewayCollectionStatus';
import { ConnectionStatus, StatusMonitor } from './StatusMonitor';

setUpTestDBConnection();
useTemporaryAppDirs();
mockLoggerToken();

let monitor: StatusMonitor;
beforeEach(() => {
  monitor = new StatusMonitor(
    Container.get(CourierSync),
    Container.get(ParcelCollectorManager),
    Container.get(GatewayRegistrar),
  );
});

describe('start', () => {
  const mockRegistrarIsRegistered = mockSpy(
    jest.spyOn(GatewayRegistrar.prototype, 'isRegistered'),
    () => true,
  );
  const mockCourierStatusStream = mockSpy(jest.spyOn(CourierSync.prototype, 'streamStatus'), () =>
    arrayToAsyncIterable([]),
  );
  const mockPubGatewayStatusStream = mockSpy(
    jest.spyOn(ParcelCollectorManager.prototype, 'streamStatus'),
    () => arrayToAsyncIterable([]),
  );

  test('Subsequent start calls should be ignored', async () => {
    await monitor.start();

    await expect(monitor.start()).toReject();

    expect(mockCourierStatusStream).toBeCalledTimes(1);
  });

  describe('Initial status', () => {
    test('Status should be DISCONNECTED if registered', async () => {
      await monitor.start();

      const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);
      expect(statuses).toEqual([ConnectionStatus.DISCONNECTED]);
    });

    test('Status should be UNREGISTERED if unregistered', async () => {
      mockRegistrarIsRegistered.mockResolvedValue(false);

      await monitor.start();

      const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);
      expect(statuses).toEqual([ConnectionStatus.UNREGISTERED]);
    });
  });

  describe('Public gateway connection changes', () => {
    test('Status should change to CONNECTED_TO_PUBLIC_GATEWAY if connected to peer', async () => {
      mockPubGatewayStatusStream.mockReturnValue(
        arrayToAsyncIterable([PublicGatewayCollectionStatus.CONNECTED]),
      );

      setImmediate(() => {
        monitor.start();
      });

      const statuses = await pipe(monitor.streamStatus(), iterableTake(2), asyncIterableToArray);
      expect(statuses).toEqual([expect.anything(), ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY]);
    });

    test('Status should change to DISCONNECTED if disconnected but registered', async () => {
      mockPubGatewayStatusStream.mockReturnValue(
        arrayToAsyncIterable([
          PublicGatewayCollectionStatus.CONNECTED,
          PublicGatewayCollectionStatus.DISCONNECTED,
        ]),
      );

      setImmediate(() => {
        monitor.start();
      });

      const statuses = await pipe(monitor.streamStatus(), iterableTake(3), asyncIterableToArray);
      expect(statuses).toEqual([
        expect.anything(),
        expect.anything(),
        ConnectionStatus.DISCONNECTED,
      ]);
    });

    test('Status should change to UNREGISTERED if disconnected and unregistered', async () => {
      mockRegistrarIsRegistered.mockResolvedValue(false);
      mockPubGatewayStatusStream.mockReturnValue(
        arrayToAsyncIterable([
          PublicGatewayCollectionStatus.CONNECTED,
          PublicGatewayCollectionStatus.DISCONNECTED,
        ]),
      );

      setImmediate(() => {
        monitor.start();
      });

      const statuses = await pipe(monitor.streamStatus(), iterableTake(3), asyncIterableToArray);
      expect(statuses).toEqual([
        expect.anything(),
        expect.anything(),
        ConnectionStatus.UNREGISTERED,
      ]);
    });

    test('Subsequent changes should be reflected', async () => {
      mockPubGatewayStatusStream.mockReturnValue(
        arrayToAsyncIterable([
          PublicGatewayCollectionStatus.CONNECTED,
          PublicGatewayCollectionStatus.DISCONNECTED,
        ]),
      );

      setImmediate(() => {
        monitor.start();
      });

      const statuses = await pipe(monitor.streamStatus(), iterableTake(3), asyncIterableToArray);
      expect(statuses).toEqual([
        expect.anything(),
        ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
        ConnectionStatus.DISCONNECTED,
      ]);
    });
  });

  describe('Courier connection changes', () => {
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

    test('Status should remain UNREGISTERED if unregistered regardless of changes', async () => {
      mockRegistrarIsRegistered.mockResolvedValue(false);
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
