import { EndpointRegistrar, MalformedEndpointKeyDigestError } from '../../endpoints/registration';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../testUtils/db';
import { testDisallowedMethods } from '../../testUtils/http';
import { mockSpy } from '../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { makeServer } from '../index';
import { CONTENT_TYPES } from './contentTypes';

const ENDPOINT_URL = '/v1/pre-registrations';

setUpTestDBConnection();
useTemporaryAppDirs();
const mockLogs = mockLoggerToken();

const mockPreRegister = mockSpy(jest.spyOn(EndpointRegistrar.prototype, 'preRegister'));

describe('Disallowed methods', () => {
  testDisallowedMethods(['POST'], ENDPOINT_URL, () => makeServer());
});

test('HTTP 415 should be returned if the request Content-Type is not text/plain', async () => {
  const fastify = await makeServer();

  const response = await fastify.inject({
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    payload: '{}',
    url: ENDPOINT_URL,
  });

  expect(response).toHaveProperty('statusCode', 415);
  expect(mockPreRegister).not.toBeCalled();
});

test('HTTP 400 should be returned if digest is malformed', async () => {
  mockPreRegister.mockRejectedValue(new MalformedEndpointKeyDigestError());
  const fastify = await makeServer();

  const response = await fastify.inject({
    headers: { 'content-type': 'text/plain' },
    method: 'POST',
    payload: '',
    url: ENDPOINT_URL,
  });

  expect(response).toHaveProperty('statusCode', 400);
  expect(response.headers['content-type']).toStartWith('application/json');
  expect(JSON.parse(response.payload)).toHaveProperty('message', 'Payload is not a SHA-256 digest');
});

test('A valid authorization should be issued if the request if valid', async () => {
  const authorizationSerialized = Buffer.from([1, 3, 5, 9]);
  mockPreRegister.mockResolvedValue(authorizationSerialized);
  const fastify = await makeServer();
  const endpointPublicKeyDigest = 'a'.repeat(64);
  const response = await fastify.inject({
    headers: { 'content-type': 'text/plain' },
    method: 'POST',
    payload: Buffer.from(endpointPublicKeyDigest, 'hex').toString('hex'),
    url: ENDPOINT_URL,
  });

  expect(response).toHaveProperty('statusCode', 200);
  expect(response.headers['content-type']).toEqual(
    CONTENT_TYPES.GATEWAY_REGISTRATION.AUTHORIZATION,
  );
  expect(response.rawPayload).toEqual(authorizationSerialized);
  expect(mockLogs).toContainEqual(
    partialPinoLog('info', 'Endpoint registration authorized', { endpointPublicKeyDigest }),
  );
});

test('HTTP 500 should be returned if an unexpected error occurs', async () => {
  const error = new Error('something happened');
  mockPreRegister.mockRejectedValue(error);
  const fastify = await makeServer();
  const endpointPublicKeyDigest = 'the digest';

  const response = await fastify.inject({
    headers: { 'content-type': 'text/plain' },
    method: 'POST',
    payload: endpointPublicKeyDigest,
    url: ENDPOINT_URL,
  });

  expect(response).toHaveProperty('statusCode', 500);
  expect(response.headers['content-type']).toStartWith('application/json');
  expect(JSON.parse(response.payload)).toHaveProperty('message', 'Internal server error');
  expect(mockLogs).toContainEqual(
    partialPinoLog('error', 'Failed to authorize endpoint registration', {
      endpointPublicKeyDigest,
      err: expect.objectContaining({ message: error.message }),
    }),
  );
});
