import { PublicAddressingError } from '@relaycorp/relaynet-core';
import LightMyRequest from 'light-my-request';

import { GatewayRegistrar } from '../../sync/publicGateway/GatewayRegistrar';
import { NonExistingAddressError } from '../../sync/publicGateway/gscClient';
import { setUpTestDBConnection } from '../../testUtils/db';
import { getMockInstance, mockSpy } from '../../testUtils/jest';
import { makeMockLogging, MockLogging, partialPinoLog } from '../../testUtils/logging';
import { makeServer } from '../index';

setUpTestDBConnection();

let mockLogging: MockLogging;
beforeEach(() => {
  mockLogging = makeMockLogging();
});

const mockRegister = mockSpy(jest.spyOn(GatewayRegistrar.prototype, 'register'));

const PUBLIC_ADDRESS = 'example.com';

describe('Set public gateway', () => {
  test('Request should be refused if content type is not JSON', async () => {
    const fastify = await makeServer(mockLogging.logger);

    const response = await fastify.inject({
      headers: { 'content-type': 'text/plain' },
      method: 'PUT',
      payload: { publicAddress: PUBLIC_ADDRESS },
      url: '/_control/public-gateway',
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

    const response = await requestPublicAddressChange(PUBLIC_ADDRESS);

    expect(mockRegister).toBeCalledWith(PUBLIC_ADDRESS);
    expect(response.statusCode).toEqual(400);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'INVALID_ADDRESS');
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('warn', 'Public address does not exist', {
        publicAddress: PUBLIC_ADDRESS,
      }),
    );
  });

  test('Change should be refused if DNS lookup or DNSSEC verification failed', async () => {
    const error = new PublicAddressingError('Could not resolve address');
    getMockInstance(mockRegister).mockRejectedValue(error);

    const response = await requestPublicAddressChange(PUBLIC_ADDRESS);

    expect(mockRegister).toBeCalledWith(PUBLIC_ADDRESS);
    expect(response.statusCode).toEqual(500);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'ADDRESS_RESOLUTION_FAILURE');
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('warn', 'Failed to resolve public address', {
        err: expect.objectContaining({ type: error.name, message: error.message }),
        publicAddress: PUBLIC_ADDRESS,
      }),
    );
  });

  test('Change should be refused if the address was valid but registration failed', async () => {
    const error = new Error('Registration failed');
    getMockInstance(mockRegister).mockRejectedValue(error);

    const response = await requestPublicAddressChange(PUBLIC_ADDRESS);

    expect(mockRegister).toBeCalledWith(PUBLIC_ADDRESS);
    expect(response.statusCode).toEqual(500);
    expect(JSON.parse(response.body)).toHaveProperty('code', 'REGISTRATION_FAILURE');
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('warn', 'Failed to complete registration', {
        err: expect.objectContaining({ message: error.message }),
        publicAddress: PUBLIC_ADDRESS,
      }),
    );
  });

  test('Change should be accepted if registration succeeds', async () => {
    const response = await requestPublicAddressChange(PUBLIC_ADDRESS);

    expect(mockRegister).toBeCalledWith(PUBLIC_ADDRESS);
    expect(response.statusCode).toEqual(204);
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Gateway migration completed', {
        publicAddress: PUBLIC_ADDRESS,
      }),
    );
  });

  test('Trailing dots should be removed from final address', async () => {
    const addressWithTrailingDot = `${PUBLIC_ADDRESS}.`;

    const response = await requestPublicAddressChange(addressWithTrailingDot);

    expect(mockRegister).toBeCalledWith(PUBLIC_ADDRESS);
    expect(response.statusCode).toEqual(204);
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Gateway migration completed', {
        publicAddress: PUBLIC_ADDRESS,
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
      url: '/_control/public-gateway',
    });
  }
});
