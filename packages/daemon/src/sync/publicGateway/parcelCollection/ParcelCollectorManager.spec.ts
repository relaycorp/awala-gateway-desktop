import isOnline from 'is-online';
import pipe from 'it-pipe';

import { asyncIterableToArray, iterableTake } from '../../../testUtils/iterables';
import { getMockInstance } from '../../../testUtils/jest';
import { PublicGatewayCollectionStatus } from '../PublicGatewayCollectionStatus';
import { ParcelCollectorManager } from './ParcelCollectorManager';

jest.mock('is-online', () => ({
  __esModule: true,
  default: jest.fn(),
}));
beforeEach(() => {
  getMockInstance(isOnline).mockRestore();
  getMockInstance(isOnline).mockResolvedValue(true);
});

describe('streamStatus (fake implementation)', () => {
  test('DISCONNECTED should be returned if disconnected', async () => {
    getMockInstance(isOnline).mockResolvedValue(false);
    const manager = new ParcelCollectorManager();

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.DISCONNECTED]);
  });

  test('CONNECTED should be returned if connected', async () => {
    const manager = new ParcelCollectorManager();

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });
});
