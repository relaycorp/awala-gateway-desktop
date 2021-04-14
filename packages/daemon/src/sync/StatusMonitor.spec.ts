import pipe from 'it-pipe';

import { asyncIterableToArray, iterableTake } from '../testUtils/iterables';
import { ConnectionStatus, StatusMonitor } from './StatusMonitor';

describe('getLastStatus', () => {
  test('DISCONNECTED_FROM_ALL should be initial status', () => {
    const monitor = new StatusMonitor();

    expect(monitor.getLastStatus()).toEqual(ConnectionStatus.DISCONNECTED_FROM_ALL);
  });

  test('Last status should be returned if explicitly set', () => {
    const monitor = new StatusMonitor();
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);

    expect(monitor.getLastStatus()).toEqual(ConnectionStatus.CONNECTED_TO_COURIER);
  });
});

describe('streamStatus', () => {
  test('Initial status should be the last known one', async () => {
    const monitor = new StatusMonitor();
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);

    const statuses = await pipe(monitor.streamStatus(), iterableTake(1), asyncIterableToArray);

    expect(statuses).toEqual([ConnectionStatus.CONNECTED_TO_COURIER]);
  });

  test('Subsequent status changes should be output', async () => {
    const monitor = new StatusMonitor();
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);

    await new Promise((resolve) => setImmediate(resolve));

    setImmediate(() => {
      monitor.setLastStatus(ConnectionStatus.DISCONNECTED_FROM_ALL);
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY);
    });
    const stream = await pipe(monitor.streamStatus(), iterableTake(3));

    await expect(asyncIterableToArray(stream)).resolves.toEqual([
      ConnectionStatus.CONNECTED_TO_COURIER,
      ConnectionStatus.DISCONNECTED_FROM_ALL,
      ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
    ]);
  });

  test('Previous statuses should be ignored', async () => {
    const monitor = new StatusMonitor();
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);
    monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY);

    setImmediate(() => {
      monitor.setLastStatus(ConnectionStatus.DISCONNECTED_FROM_ALL);
      monitor.setLastStatus(ConnectionStatus.CONNECTED_TO_COURIER);
    });
    const stream = await monitor.streamStatus();

    await expect(pipe(stream, iterableTake(3), asyncIterableToArray)).resolves.toEqual([
      ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
      ConnectionStatus.DISCONNECTED_FROM_ALL,
      ConnectionStatus.CONNECTED_TO_COURIER,
    ]);
  });
});
