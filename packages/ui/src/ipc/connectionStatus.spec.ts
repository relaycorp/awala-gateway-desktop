import pipe from 'it-pipe';
import * as itws from 'it-ws';
import { sleep } from './_utils';

import { asyncIterableToArray, iterableTake } from '../testUtils/iterables';
import { ConnectionStatus, pollConnectionStatus } from './connectionStatus';

jest.mock('it-ws', () => ({
  connect: jest.fn(),
}));

describe('pollConnectionStatus', () => {
  test('load the status over a websocket', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      source: (async function* fakeSource(): AsyncIterable<string> {
        yield 'CONNECTED_TO_PUBLIC_GATEWAY';
        await sleep(1);

        yield 'CONNECTED_TO_COURIER';
        await sleep(1);

        yield 'DISCONNECTED_FROM_PUBLIC_GATEWAY';
        await sleep(1);

        yield 'DISCONNECTED';
      })(),
    });

    jest.setTimeout(30_000);

    const statuses = await pipe(
      pollConnectionStatus('TOKEN').promise,
      iterableTake(4),
      asyncIterableToArray,
    );

    expect(statuses).toEqual([
      ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY,
      ConnectionStatus.CONNECTED_TO_COURIER,
      ConnectionStatus.DISCONNECTED_FROM_PUBLIC_GATEWAY,
      ConnectionStatus.DISCONNECTED,
    ]);
  });
});
