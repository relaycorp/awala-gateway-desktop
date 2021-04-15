import pipe from 'it-pipe';
import * as itws from 'it-ws';
import { sleep } from './_utils';

import { asyncIterableToArray } from '../testUtils/iterables';
import { CourierSyncStatus, synchronizeWithCourier } from './courierSync';

jest.mock('it-ws', () => ({
  connect: jest.fn(),
}));

describe('synchronizeWithCourier', () => {
  test('should temporarily cycle through all the possible statuses', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      source: (async function* fakeSource(): AsyncIterable<string> {
        yield 'COLLECTING_CARGO';
        await sleep(1);

        yield 'WAITING';
        await sleep(1);

        yield 'DELIVERING_CARGO';
        await sleep(1);

        yield 'COMPLETE';
      })(),
    });
    jest.setTimeout(20_000);

    const statuses = await pipe(synchronizeWithCourier('TOKEN').promise, asyncIterableToArray);

    expect(statuses).toEqual([
      CourierSyncStatus.COLLECTING_CARGO,
      CourierSyncStatus.WAITING,
      CourierSyncStatus.DELIVERING_CARGO,
      CourierSyncStatus.COMPLETE,
    ]);
  });
});
