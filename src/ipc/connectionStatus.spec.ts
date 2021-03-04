import pipe from 'it-pipe';

import { asyncIterableToArray, iterableTake } from '../testUtils/iterables';
import { ConnectionStatus, pollConnectionStatus } from './connectionStatus';

describe('pollConnectionStatus', () => {
  test('should temporarily cycle through all the possible statuses', async () => {
    jest.setTimeout(30_000);

    const statuses = await pipe(pollConnectionStatus(), iterableTake(4), asyncIterableToArray);

    expect(statuses).toEqual([
      ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
      ConnectionStatus.CONNECTED_TO_COURIER,
      ConnectionStatus.DISCONNECTED_FROM_PUBLIC_GATEWAY,
      ConnectionStatus.DISCONNECTED_FROM_ALL,
    ]);
  });
});
