import { setUpTestDBConnection } from '../testUtils/db';
import { makeMockLogging, MockLogging } from '../testUtils/logging';
import { makeServer } from './index';

setUpTestDBConnection();

let mockLogging: MockLogging;
beforeEach(() => {
  mockLogging = makeMockLogging();
});

describe('disableCors', () => {
  test('Request with Origin header should be removed', async () => {
    const fastify = await makeServer(mockLogging.logger);

    const response = await fastify.inject({ url: '/', headers: { origin: 'https://example.com' } });

    expect(response.statusCode).toEqual(400);
    expect(JSON.parse(response.body)).toHaveProperty('message', 'CORS requests are forbidden');
  });

  test('Request without Origin header should be allowed', async () => {
    const fastify = await makeServer(mockLogging.logger);

    const response = await fastify.inject({ url: '/' });

    expect(response.statusCode).toEqual(404);
  });
});
