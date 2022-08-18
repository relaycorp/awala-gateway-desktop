import { InternetAddressingError, UnreachableResolverError } from '@relaycorp/relaynet-core';
import LightMyRequest from 'light-my-request';
import { Container } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_INTERNET_GATEWAY_ADDRESS } from '../../constants';
import { GatewayRegistrar } from '../../sync/internetGateway/GatewayRegistrar';
import { ParcelCollectorManager } from '../../sync/internetGateway/parcelCollection/ParcelCollectorManager';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../testUtils/db';
import { getMockInstance, mockSpy } from '../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { makeServer } from '../index';
import { CONTROL_API_PREFIX } from './index';
import { NonExistingAddressError } from '../../sync/internetGateway/errors';

setUpTestDBConnection();
useTemporaryAppDirs();

const mockLogs = mockLoggerToken();

const mockRegister = mockSpy(jest.spyOn(GatewayRegistrar.prototype, 'register'));

const NEW_INTERNET_ADDRESS = `new.${DEFAULT_INTERNET_GATEWAY_ADDRESS}`;
const ENDPOINT_PATH = `${CONTROL_API_PREFIX}/public-gateway`;

const AUTH_TOKEN = 'the-auth-token';
const BASE_HEADERS = { authorization: `Bearer ${AUTH_TOKEN}` };

describe('Get Internet gateway', () => {
  test('The current gateway should be returned if registered', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.INTERNET_GATEWAY_ADDRESS, NEW_INTERNET_ADDRESS);
    const fastify = await makeServer(AUTH_TOKEN);

    const response = await fastify.inject({
      headers: BASE_HEADERS,
      method: 'GET',
      url: ENDPOINT_PATH,
    });

    expect(response.statusCode).toEqual(200);
    expect(JSON.parse(response.body)).toHaveProperty('internetAddress', NEW_INTERNET_ADDRESS);
  });

  test('The default gateway should be returned if unregistered', async () => {
    const fastify = await makeServer(AUTH_TOKEN);

    const response = await fastify.inject({
      headers: BASE_HEADERS,
      method: 'GET',
      url: ENDPOINT_PATH,
    });

    expect(response.statusCode).toEqual(200);
    expect(JSON.parse(response.body)).toHaveProperty(
      'internetAddress',
      DEFAULT_INTERNET_GATEWAY_ADDRESS,
    );
  });

  test('Request should be refused if auth fails', async () => {
    const fastify = await makeServer(AUTH_TOKEN);

    const response = await fastify.inject({ method: 'GET', url: ENDPOINT_PATH });

    expect(response.statusCode).toEqual(401);
  });
});

describe('Set Internet gateway', () => {
  const mockParcelCollectorManagerRestart = mockSpy(
    jest.spyOn(ParcelCollectorManager.prototype, 'restart'),
    () => {
      // Do nothing
    },
  );

  test('Request should be refused if content type is not JSON', async () => {
    const fastify = await makeServer(AUTH_TOKEN);

    const response = await fastify.inject({
      headers: { ...BASE_HEADERS, 'content-type': 'text/plain' },
      method: 'PUT',
      payload: { internetAddress: NEW_INTERNET_ADDRESS },
      url: ENDPOINT_PATH,
    });

    expect(response.statusCode).toEqual(415);
    expect(mockParcelCollectorManagerRestart).not.toBeCalled();
  });

  test('Request should be refused if address is missing', async () => {
    const response = await requestInternetAddressChange();

    expect(response.statusCode).toEqual(400);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'MALFORMED_ADDRESS');
    expect(mockLogs).toContainEqual(partialPinoLog('warn', 'Malformed Internet address'));
    expect(mockRegister).not.toBeCalled();
    expect(mockParcelCollectorManagerRestart).not.toBeCalled();
  });

  test('Change should be refused if address is syntactically invalid', async () => {
    const malformedInternetAddress = '.example.com';

    const response = await requestInternetAddressChange(malformedInternetAddress);

    expect(response.statusCode).toEqual(400);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'MALFORMED_ADDRESS');
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Malformed Internet address', {
        internetAddress: malformedInternetAddress,
      }),
    );
    expect(mockRegister).not.toBeCalled();
    expect(mockParcelCollectorManagerRestart).not.toBeCalled();
  });

  test('Change should be refused if the address does not exist', async () => {
    const error = new NonExistingAddressError('Address does not exist');
    getMockInstance(mockRegister).mockRejectedValue(error);

    const response = await requestInternetAddressChange(NEW_INTERNET_ADDRESS);

    expect(mockRegister).toBeCalledWith(NEW_INTERNET_ADDRESS);
    expect(response.statusCode).toEqual(400);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'INVALID_ADDRESS');
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Internet address does not exist', {
        internetAddress: NEW_INTERNET_ADDRESS,
      }),
    );
    expect(mockParcelCollectorManagerRestart).not.toBeCalled();
  });

  test('Change should be refused if DNS resolver is unreachable', async () => {
    const error = new UnreachableResolverError('Disconnected');
    getMockInstance(mockRegister).mockRejectedValue(error);

    const response = await requestInternetAddressChange(NEW_INTERNET_ADDRESS);

    expect(mockRegister).toBeCalledWith(NEW_INTERNET_ADDRESS);
    expect(response.statusCode).toEqual(500);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'ADDRESS_RESOLUTION_FAILURE');
    expect(mockLogs).toContainEqual(partialPinoLog('warn', 'Failed to reach DNS resolver'));
    expect(mockParcelCollectorManagerRestart).not.toBeCalled();
  });

  test('Change should be refused if DNS lookup or DNSSEC verification failed', async () => {
    const error = new InternetAddressingError('Could not resolve address');
    getMockInstance(mockRegister).mockRejectedValue(error);

    const response = await requestInternetAddressChange(NEW_INTERNET_ADDRESS);

    expect(mockRegister).toBeCalledWith(NEW_INTERNET_ADDRESS);
    expect(response.statusCode).toEqual(500);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'ADDRESS_RESOLUTION_FAILURE');
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Failed to resolve Internet address', {
        err: expect.objectContaining({ type: error.name, message: error.message }),
        internetAddress: NEW_INTERNET_ADDRESS,
      }),
    );
    expect(mockParcelCollectorManagerRestart).not.toBeCalled();
  });

  test('Change should be refused if the address was valid but registration failed', async () => {
    const error = new Error('Registration failed');
    getMockInstance(mockRegister).mockRejectedValue(error);

    const response = await requestInternetAddressChange(NEW_INTERNET_ADDRESS);

    expect(mockRegister).toBeCalledWith(NEW_INTERNET_ADDRESS);
    expect(response.statusCode).toEqual(500);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'REGISTRATION_FAILURE');
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Failed to complete registration', {
        err: expect.objectContaining({ message: error.message }),
        internetAddress: NEW_INTERNET_ADDRESS,
      }),
    );
    expect(mockParcelCollectorManagerRestart).not.toBeCalled();
  });

  test('Change should be accepted if registration succeeds', async () => {
    const response = await requestInternetAddressChange(NEW_INTERNET_ADDRESS);

    expect(mockRegister).toBeCalledWith(NEW_INTERNET_ADDRESS);
    expect(response.statusCode).toEqual(204);
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Gateway migration completed', {
        internetAddress: NEW_INTERNET_ADDRESS,
      }),
    );
    expect(mockParcelCollectorManagerRestart).toBeCalled();
  });

  test('Trailing dots should be removed from final address', async () => {
    const addressWithTrailingDot = `${NEW_INTERNET_ADDRESS}.`;

    const response = await requestInternetAddressChange(addressWithTrailingDot);

    expect(mockRegister).toBeCalledWith(NEW_INTERNET_ADDRESS);
    expect(response.statusCode).toEqual(204);
    expect(mockLogs).toContainEqual(
      partialPinoLog('info', 'Gateway migration completed', {
        internetAddress: NEW_INTERNET_ADDRESS,
      }),
    );
  });

  test('Request should be refused if authentication fails', async () => {
    const fastify = await makeServer(AUTH_TOKEN);

    const response = await fastify.inject({
      method: 'PUT',
      payload: { internetAddress: NEW_INTERNET_ADDRESS },
      url: ENDPOINT_PATH,
    });

    expect(response.statusCode).toEqual(401);
    expect(mockLogs).toContainEqual(partialPinoLog('warn', 'Refusing unauthenticated request'));
    expect(mockRegister).not.toBeCalled();
    expect(mockParcelCollectorManagerRestart).not.toBeCalled();
  });

  async function requestInternetAddressChange(
    internetAddress?: string,
  ): Promise<LightMyRequest.Response> {
    const fastify = await makeServer(AUTH_TOKEN);
    return fastify.inject({
      headers: { ...BASE_HEADERS, 'content-type': 'application/json' },
      method: 'PUT',
      payload: { internetAddress },
      url: ENDPOINT_PATH,
    });
  }
});
