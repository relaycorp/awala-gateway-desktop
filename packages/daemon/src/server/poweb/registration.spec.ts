import { EndpointRegistrar, InvalidRegistrationRequestError } from '../../endpoints/registration';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../testUtils/db';
import { testDisallowedMethods } from '../../testUtils/http';
import { mockSpy } from '../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { makeServer } from '../index';
import { CONTENT_TYPES } from './contentTypes';

const ENDPOINT_URL = '/v1/nodes';

setUpTestDBConnection();
useTemporaryAppDirs();

const mockLogs = mockLoggerToken();

const mockCompleteRegistration = mockSpy(
  jest.spyOn(EndpointRegistrar.prototype, 'completeRegistration'),
);

describe('Disallowed methods', () => {
  testDisallowedMethods(['POST'], ENDPOINT_URL, () => makeServer());
});

test('HTTP 415 should be returned if the request Content-Type is not a PNRR', async () => {
  const fastify = await makeServer();

  const response = await fastify.inject({
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    payload: '{}',
    url: ENDPOINT_URL,
  });

  expect(response).toHaveProperty('statusCode', 415);
  expect(mockCompleteRegistration).not.toBeCalled();
});

test('HTTP 400 should be returned if the PNRR is not valid', async () => {
  const fastify = await makeServer();
  const pnrrSerialized = Buffer.from('the request');
  mockCompleteRegistration.mockRejectedValue(new InvalidRegistrationRequestError());

  const response = await fastify.inject({
    headers: { 'content-type': CONTENT_TYPES.GATEWAY_REGISTRATION.REQUEST },
    method: 'POST',
    payload: pnrrSerialized,
    url: ENDPOINT_URL,
  });

  expect(response).toHaveProperty('statusCode', 400);
  expect(mockCompleteRegistration).toBeCalledWith(pnrrSerialized);
  expect(JSON.parse(response.payload)).toHaveProperty(
    'message',
    'Registration request is malformed/invalid',
  );
  expect(mockLogs).toContainEqual(
    partialPinoLog('warn', 'Refusing registration due to malformed/invalid request'),
  );
});

test('HTTP 200 with the registration should be returned if successful', async () => {
  const fastify = await makeServer();
  const pnrrSerialized = Buffer.from('the request');
  const authorizationSerialized = Buffer.from('the auth');
  mockCompleteRegistration.mockResolvedValue(authorizationSerialized);

  const response = await fastify.inject({
    headers: { 'content-type': CONTENT_TYPES.GATEWAY_REGISTRATION.REQUEST },
    method: 'POST',
    payload: pnrrSerialized,
    url: ENDPOINT_URL,
  });

  expect(response).toHaveProperty('statusCode', 200);
  expect(mockCompleteRegistration).toBeCalledWith(pnrrSerialized);
  expect(response.rawPayload).toEqual(authorizationSerialized);
  expect(response.headers).toHaveProperty(
    'content-type',
    CONTENT_TYPES.GATEWAY_REGISTRATION.REGISTRATION,
  );
  expect(mockLogs).toContainEqual(partialPinoLog('info', 'Completed endpoint registration'));
});

test('HTTP 500 should be returned if an unexpected error occurs', async () => {
  const fastify = await makeServer();
  const error = new Error('whoops');
  mockCompleteRegistration.mockRejectedValue(error);

  const response = await fastify.inject({
    headers: { 'content-type': CONTENT_TYPES.GATEWAY_REGISTRATION.REQUEST },
    method: 'POST',
    payload: Buffer.from('the request'),
    url: ENDPOINT_URL,
  });

  expect(response).toHaveProperty('statusCode', 500);
  expect(JSON.parse(response.payload)).toHaveProperty('message', 'Internal server error');
  expect(mockLogs).toContainEqual(
    partialPinoLog('error', 'Endpoint registration failed', {
      err: expect.objectContaining({
        message: error.message,
      }),
    }),
  );
});
