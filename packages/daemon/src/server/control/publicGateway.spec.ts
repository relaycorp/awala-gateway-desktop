import { PublicAddressingError } from '@relaycorp/relaynet-core';
import LightMyRequest from 'light-my-request';
import { Container } from 'typedi';

import { Config } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { GatewayRegistrar } from '../../sync/publicGateway/GatewayRegistrar';
import { NonExistingAddressError } from '../../sync/publicGateway/gscClient';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { makeConfigTokenEphemeral } from '../../testUtils/config';
import { setUpTestDBConnection } from '../../testUtils/db';
import { getMockInstance, mockSpy } from '../../testUtils/jest';
import { makeMockLogging, MockLogging, partialPinoLog } from '../../testUtils/logging';
import { PUBLIC_GATEWAY_ADDRESS } from '../../tokens';
import { makeServer } from '../index';

setUpTestDBConnection();
useTemporaryAppDirs();

makeConfigTokenEphemeral(PUBLIC_GATEWAY_ADDRESS);

let mockLogging: MockLogging;
beforeEach(() => {
  mockLogging = makeMockLogging();
});

const mockRegister = mockSpy(jest.spyOn(GatewayRegistrar.prototype, 'register'));

const NEW_PUBLIC_ADDRESS = `new.${DEFAULT_PUBLIC_GATEWAY}`;
const ENDPOINT_PATH = '/_control/public-gateway';

describe('Get public gateway', () => {
  test('The current gateway should be returned if registered', async () => {
    const config = Container.get(Config);
    await config.set(PUBLIC_GATEWAY_ADDRESS, NEW_PUBLIC_ADDRESS);
    const fastify = await makeServer(mockLogging.logger);

    const response = await fastify.inject({ method: 'GET', url: ENDPOINT_PATH });

    expect(response.statusCode).toEqual(200);
    expect(JSON.parse(response.body)).toHaveProperty('publicAddress', NEW_PUBLIC_ADDRESS);
  });

  test('The default gateway should be returned if unregistered', async () => {
    const fastify = await makeServer(mockLogging.logger);

    const response = await fastify.inject({ method: 'GET', url: ENDPOINT_PATH });

    expect(response.statusCode).toEqual(200);
    expect(JSON.parse(response.body)).toHaveProperty('publicAddress', DEFAULT_PUBLIC_GATEWAY);
  });
});

describe('Set public gateway', () => {
  test('Request should be refused if content type is not JSON', async () => {
    const fastify = await makeServer(mockLogging.logger);

    const response = await fastify.inject({
      headers: { 'content-type': 'text/plain' },
      method: 'PUT',
      payload: { publicAddress: NEW_PUBLIC_ADDRESS },
      url: ENDPOINT_PATH,
    });

    expect(response.statusCode).toEqual(415);
  });

  test('Request should be refused if address is missing', async () => {
    const response = await requestPublicAddressChange();

    expect(response.statusCode).toEqual(400);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'MALFORMED_ADDRESS');
    expect(mockLogging.logs).toContainEqual(partialPinoLog('warn', 'Malformed public address'));
    expect(mockRegister).not.toBeCalled();
  });

  test('Change should be refused if address is syntactically invalid', async () => {
    const malformedPublicAddress = '.example.com';

    const response = await requestPublicAddressChange(malformedPublicAddress);

    expect(response.statusCode).toEqual(400);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'MALFORMED_ADDRESS');
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('warn', 'Malformed public address', { publicAddress: malformedPublicAddress }),
    );
    expect(mockRegister).not.toBeCalled();
  });

  test('Change should be refused if the address does not exist', async () => {
    const error = new NonExistingAddressError('Address does not exist');
    getMockInstance(mockRegister).mockRejectedValue(error);

    const response = await requestPublicAddressChange(NEW_PUBLIC_ADDRESS);

    expect(mockRegister).toBeCalledWith(NEW_PUBLIC_ADDRESS);
    expect(response.statusCode).toEqual(400);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'INVALID_ADDRESS');
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('warn', 'Public address does not exist', {
        publicAddress: NEW_PUBLIC_ADDRESS,
      }),
    );
  });

  test('Change should be refused if DNS lookup or DNSSEC verification failed', async () => {
    const error = new PublicAddressingError('Could not resolve address');
    getMockInstance(mockRegister).mockRejectedValue(error);

    const response = await requestPublicAddressChange(NEW_PUBLIC_ADDRESS);

    expect(mockRegister).toBeCalledWith(NEW_PUBLIC_ADDRESS);
    expect(response.statusCode).toEqual(500);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'ADDRESS_RESOLUTION_FAILURE');
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('warn', 'Failed to resolve public address', {
        err: expect.objectContaining({ type: error.name, message: error.message }),
        publicAddress: NEW_PUBLIC_ADDRESS,
      }),
    );
  });

  test('Change should be refused if the address was valid but registration failed', async () => {
    const error = new Error('Registration failed');
    getMockInstance(mockRegister).mockRejectedValue(error);

    const response = await requestPublicAddressChange(NEW_PUBLIC_ADDRESS);

    expect(mockRegister).toBeCalledWith(NEW_PUBLIC_ADDRESS);
    expect(response.statusCode).toEqual(500);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'REGISTRATION_FAILURE');
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('warn', 'Failed to complete registration', {
        err: expect.objectContaining({ message: error.message }),
        publicAddress: NEW_PUBLIC_ADDRESS,
      }),
    );
  });

  test('Change should be accepted if registration succeeds', async () => {
    const response = await requestPublicAddressChange(NEW_PUBLIC_ADDRESS);

    expect(mockRegister).toBeCalledWith(NEW_PUBLIC_ADDRESS);
    expect(response.statusCode).toEqual(204);
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Gateway migration completed', {
        publicAddress: NEW_PUBLIC_ADDRESS,
      }),
    );
  });

  test('Trailing dots should be removed from final address', async () => {
    const addressWithTrailingDot = `${NEW_PUBLIC_ADDRESS}.`;

    const response = await requestPublicAddressChange(addressWithTrailingDot);

    expect(mockRegister).toBeCalledWith(NEW_PUBLIC_ADDRESS);
    expect(response.statusCode).toEqual(204);
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Gateway migration completed', {
        publicAddress: NEW_PUBLIC_ADDRESS,
      }),
    );
  });

  async function requestPublicAddressChange(
    publicAddress?: string,
  ): Promise<LightMyRequest.Response> {
    const fastify = await makeServer(mockLogging.logger);
    return fastify.inject({
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      payload: { publicAddress },
      url: ENDPOINT_PATH,
    });
  }
});
