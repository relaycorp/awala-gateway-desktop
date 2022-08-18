import pipe from 'it-pipe';
import * as itws from 'it-ws';
import { sleep } from './_utils';

import { asyncIterableToArray } from '../testUtils/iterables';
import { ConnectionStatus, pollConnectionStatus } from './connectionStatus';

jest.mock('it-ws', () => ({
  connect: jest.fn(),
}));

describe('pollConnectionStatus', () => {
  test('load the status over a websocket', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      source: (async function* fakeSource(): AsyncIterable<string> {
        yield 'UNREGISTERED';
        await sleep(1);

        yield 'CONNECTED_TO_INTERNET_GATEWAY';
        await sleep(1);

        yield 'CONNECTED_TO_COURIER';
        await sleep(1);

        yield 'DISCONNECTED';
        await sleep(1);
      })(),
    });

    jest.setTimeout(10_000);

    const statuses = await pipe(pollConnectionStatus('TOKEN').promise, asyncIterableToArray);

    expect(statuses).toEqual([
      ConnectionStatus.UNREGISTERED,
      ConnectionStatus.CONNECTED_TO_INTERNET_GATEWAY,
      ConnectionStatus.CONNECTED_TO_COURIER,
      ConnectionStatus.DISCONNECTED,
    ]);
  });
  test('should be abortable', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      source: (async function* fakeSource(): AsyncIterable<string> {
        await sleep(1);
        yield 'CONNECTED_TO_INTERNET_GATEWAY';
      })(),
    });

    const { promise, abort } = pollConnectionStatus('TOKEN');
    abort();
    const handleStatus = jest.fn();
    for await (const item of promise) {
      handleStatus(item);
    }
    expect(handleStatus).toHaveBeenCalledTimes(0);
  });
});
