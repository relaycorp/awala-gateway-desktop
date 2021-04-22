import { v4 } from 'default-gateway';
import pipe from 'it-pipe';

import { asyncIterableToArray, iterableTake } from '../../../testUtils/iterables';
import { getMockInstance } from '../../../testUtils/jest';
import { PublicGatewayCollectionStatus } from '../PublicGatewayCollectionStatus';
import { ParcelCollectorManager } from './ParcelCollectorManager';

jest.mock('default-gateway', () => ({ v4: jest.fn() }));
const mockGatewayIPAddr = '192.168.0.12';
beforeEach(() => {
  getMockInstance(v4).mockRestore();
  getMockInstance(v4).mockResolvedValue({ gateway: mockGatewayIPAddr });
});

describe('streamStatus (fake implementation)', () => {
  test('DISCONNECTED should be returned if disconnected from WiFi network', async () => {
    getMockInstance(v4).mockRejectedValue(new Error());
    const manager = new ParcelCollectorManager();

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.DISCONNECTED]);
  });

  test('CONNECTED should be returned if connected to WiFi network', async () => {
    const manager = new ParcelCollectorManager();

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });
});
