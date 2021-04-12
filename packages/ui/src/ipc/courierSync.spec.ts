import pipe from 'it-pipe';

import { asyncIterableToArray } from '../testUtils/iterables';
import { CourierSyncStatus, synchronizeWithCourier } from './courierSync';

describe('synchronizeWithCourier', () => {
  test('should temporarily cycle through all the possible statuses', async () => {
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
