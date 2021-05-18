import { ParcelStore } from './parcelStore';
import { arrayBufferFrom } from './testUtils/buffer';

describe('storeInternetBoundParcel', () => {
  test('TODO', async () => {
    const store = new ParcelStore();
    await expect(store.storeInternetBoundParcel(arrayBufferFrom(''))).toReject();
  });
});
