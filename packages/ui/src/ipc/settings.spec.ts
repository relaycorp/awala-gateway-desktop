import fetchMock from 'fetch-mock-jest';
import { getPublicGatewayAddress, migratePublicGatewayAddress, SettingError } from './settings';

beforeEach(() => {
  fetchMock.reset();
});

describe('getPublicGatewayAddress', () => {
  const publicAddress = 'braavos.relaycorp.cloud';
  const request = {
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    url: 'http://127.0.0.1:13276/_control/public-gateway',
  };
  test('should fetch and return the publicAddress', async () => {
    fetchMock.get(request, {
      body: { publicAddress },
      status: 200,
    });

    const publicGateway = await getPublicGatewayAddress('TOKEN');
    expect(publicGateway).toEqual(publicAddress);

    expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
  });
  test('should throw SettingError on a server error message', async () => {
    fetchMock.get(request, {
      body: { message: 'error message' },
      status: 500,
    });
    try {
      await getPublicGatewayAddress('TOKEN');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingError);
      expect(error.message).toEqual('error message');
    }
  });
  test('should throw SettingError on a random response', async () => {
    fetchMock.get(request, {
      body: {},
      status: 404,
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
  const request = {
    headers: { 'Content-Type': 'application/json' },
    url: 'http://127.0.0.1:13276/_control/public-gateway',
  };
  test('should temporarily accept any address', async () => {
    fetchMock.put(request, {
      status: 204,
    });
    await migratePublicGatewayAddress('kings-landing.relaycorp.cloud', 'TOKEN');
    expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
  });
  test('should throw SettingError on a 400 with a code', async () => {
    fetchMock.put(request, {
      body: { code: 'MALFORMED_ADDRESS' },
      status: 400,
    });
    try {
      await migratePublicGatewayAddress('kings-landing.relaycorp.cloud', 'TOKEN');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingError);
      expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
    }
  });
  test('should throw SettingError on a 500 with a code', async () => {
    fetchMock.put(request, {
      body: { code: 'ADDRESS_RESOLUTION_FAILURE' },
      status: 500,
    });
    try {
      await migratePublicGatewayAddress('kings-landing.relaycorp.cloud', 'TOKEN');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingError);
      expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
    }
  });
  test('should throw SettingError on a random response', async () => {
    fetchMock.put(request, {
      body: {},
      status: 400,
    });
    try {
      await migratePublicGatewayAddress('kings-landing.relaycorp.cloud', 'TOKEN');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingError);
      expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
    }
  });
  test('should throw SettingError on a random response', async () => {
    fetchMock.put(request, {
      status: 404,
    });
    try {
      await migratePublicGatewayAddress('kings-landing.relaycorp.cloud', 'TOKEN');
    } catch (error) {
      expect(error).toBeInstanceOf(SettingError);
      expect(fetchMock.lastUrl()).toEqual('http://127.0.0.1:13276/_control/public-gateway');
    }
  });
});
