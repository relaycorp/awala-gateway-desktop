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
      socket: {
        addEventListener: (_name: string, callback: (event: CloseEvent) => void) => {
          callback(new CloseEvent('close', { code: 1000 }));
        },
      },
      source: (async function* fakeSource(): AsyncIterable<string> {
        yield 'COLLECTION';
        await sleep(1);

        yield 'WAIT';
        await sleep(1);

        yield 'DELIVERY';
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
  test('should throw an error and not yield an unknown status', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      socket: {
        addEventListener: (_name: string, callback: (event: CloseEvent) => void) => {
          callback(new CloseEvent('close', { code: 1000 }));
        },
      },
      source: (async function* buggySource(): AsyncIterable<string> {
        yield 'UNKNOWN_STATUS';
        await sleep(1);
      })(),
    });

    const handleStatus = jest.fn();
    try {
      for await (const item of synchronizeWithCourier('TOKEN').promise) {
        handleStatus(item);
      }
    } catch (err: any) {
      expect(err).toBeInstanceOf(CourierSyncError);
      expect(err.message).toMatch(/Unknown status/i);
      expect(handleStatus).toHaveBeenCalledTimes(0);
    }
  });
  test('should throw an error on promise rejection status', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      socket: {
        addEventListener: (_name: string, callback: (event: CloseEvent) => void) => {
          callback(new CloseEvent('close', { code: 1000 }));
        },
      },
      source: (async function* failingSource(): AsyncIterable<string> {
        return Promise.reject('REJECTED');
      })(),
    });

    const handleStatus = jest.fn();
    try {
      for await (const item of synchronizeWithCourier('TOKEN').promise) {
        handleStatus(item);
      }
    } catch (err) {
      expect(err).toBeInstanceOf(CourierSyncError);
      expect(handleStatus).toHaveBeenCalledTimes(0);
    }
  });
  test('should be abortable', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      socket: {
        addEventListener: (_name: string, callback: (event: CloseEvent) => void) => {
          callback(new CloseEvent('close', { code: 1000 }));
        },
      },
      source: (async function* fakeSource(): AsyncIterable<string> {
        await sleep(1);
        yield 'COLLECTION';
      })(),
    });

    const { promise, abort } = synchronizeWithCourier('TOKEN');
    abort();
    const handleStatus = jest.fn();
    for await (const item of promise) {
      handleStatus(item);
    }
    expect(handleStatus).toHaveBeenCalledTimes(0);
  });
  test('should throw an exception on a closing error code', async () => {
    (itws.connect as jest.Mock).mockReturnValue({
      socket: {
        addEventListener: (_name: string, callback: (event: CloseEvent) => void) => {
          callback(new CloseEvent('close', { code: 1011 }));
        },
      },
      source: (async function* fakeSource(): AsyncIterable<string> {
        await sleep(1);
        yield 'COLLECTION';
      })(),
    });

    const { promise } = synchronizeWithCourier('TOKEN');
    const handleStatus = jest.fn();
    try {
      for await (const item of promise) {
        handleStatus(item);
      }
    } catch (err: any) {
      expect(err).toBeInstanceOf(CourierSyncError);
      expect(err.message).toMatch(/1011/i);
    }
  });
});
