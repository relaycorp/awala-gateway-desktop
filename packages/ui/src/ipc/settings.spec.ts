import fetchMock from 'fetch-mock-jest';
import { getPublicGatewayAddress, migratePublicGatewayAddress, SettingError } from './settings';

beforeEach(() => {
  fetchMock.reset();
});

describe('getPublicGatewayAddress', () => {
  const publicAddress = 'braavos.relaycorp.cloud';
  test('should fetch and return the publicAddress', async () => {
    fetchMock.once(
      {
        url: 'http://127.0.0.1:13276/_control/public-gateway',
        method: 'GET'
      },
      {
        status: 200,
        body: { publicAddress },
      }
    );

    const publicGateway = await getPublicGatewayAddress('TOKEN');
    expect(publicGateway).toEqual(publicAddress);

    expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
  });
  test('should throw SettingError on a random response', async () => {
    fetchMock.once('http://127.0.0.1:13276/_control/public-gateway', {
      status: 404,
      statusText: 'Unknown'
    });
    try {
      await getPublicGatewayAddress('TOKEN');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingError);
      expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
    }
  });
});

describe('migratePublicGatewayAddress', () => {
  test('should temporarily accept any address', async () => {
    fetchMock.once(
      {
        url: 'http://127.0.0.1:13276/_control/public-gateway',
        method: 'PUT'
      },
      { status: 204 }
    );
    await migratePublicGatewayAddress('kings-landing.relaycorp.cloud', 'TOKEN');
    expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
  });
  test('should throw SettingError on a 400 with a code', async () => {
    fetchMock.once('http://127.0.0.1:13276/_control/public-gateway', {
      status: 400,
      body: { code: 'MALFORMED_ADDRESS' },
    });
    try {
      await migratePublicGatewayAddress('kings-landing.relaycorp.cloud', 'TOKEN');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingError);
      expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
    }
  });
  test('should throw SettingError on a 500 with a code', async () => {
    fetchMock.once('http://127.0.0.1:13276/_control/public-gateway', {
      status: 500,
      body: { code: 'ADDRESS_RESOLUTION_FAILURE' },
    });
    try {
      await migratePublicGatewayAddress('kings-landing.relaycorp.cloud', 'TOKEN');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingError);
      expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
    }
  });
  test('should throw SettingError on a random response', async () => {
    fetchMock.once('http://127.0.0.1:13276/_control/public-gateway', {
      status: 404,
      statusText: 'Unknown'
    });
    try {
      await migratePublicGatewayAddress('kings-landing.relaycorp.cloud', 'TOKEN');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingError);
      expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
    }
  });
});
