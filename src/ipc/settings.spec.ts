import { getPublicGatewayAddress, migratePublicGatewayAddress } from './settings';

describe('getPublicGatewayAddress', () => {
  test('should temporarily return braavos.relaycorp.cloud', async () => {
    const publicGateway = await getPublicGatewayAddress();

    expect(publicGateway).toEqual('braavos.relaycorp.cloud');
  });
});

describe('migratePublicGatewayAddress', () => {
  test('should temporarily accept any address', async () => {
    await migratePublicGatewayAddress('kings-landing.relaycorp.cloud');
  });
});
