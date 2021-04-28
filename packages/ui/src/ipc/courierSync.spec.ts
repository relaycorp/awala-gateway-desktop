import pipe from 'it-pipe';
import * as itws from 'it-ws';
import { sleep } from './_utils';

import { asyncIterableToArray } from '../testUtils/iterables';
import { CourierSyncError, CourierSyncStatus, synchronizeWithCourier } from './courierSync';

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
      })(),
    });
    jest.setTimeout(5_000);

    const statuses = await pipe(synchronizeWithCourier('TOKEN').promise, asyncIterableToArray);

    expect(statuses).toEqual([
      CourierSyncStatus.COLLECTING_CARGO,
      CourierSyncStatus.WAITING,
      CourierSyncStatus.DELIVERING_CARGO,
      CourierSyncStatus.COMPLETE,
    ]);
  });
  test('should throw an error on unknown status', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      source: (async function* buggySource(): AsyncIterable<string> {
        yield 'UNKNOWN_STATUS';
      })(),
    });
    jest.setTimeout(3_000);

    try {
      await synchronizeWithCourier('TOKEN').promise;
    } catch (err) {
      expect(err).toBeInstanceOf(CourierSyncError);
      expect(err.message).toEqual('Unknown status: UNKNOWN_STATUS');
    }
  });
  test('should throw an error on promise rejection status', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      source: (async function* failingSource(): AsyncIterable<string> {
        return Promise.reject('REJECTED');
      })(),
    });
    jest.setTimeout(3_000);

    try {
      await synchronizeWithCourier('TOKEN').promise;
    } catch (err) {
      expect(err).toBeInstanceOf(CourierSyncError);
    }
  });
  test('should be abortable', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      source: (async function* fakeSource(): AsyncIterable<string> {
        await sleep(5);
        yield 'COLLECTING_CARGO';
      })(),
    });
    jest.setTimeout(1_000);

    const { promise, abort } = synchronizeWithCourier('TOKEN');
    abort();
    await promise;
  });
});
