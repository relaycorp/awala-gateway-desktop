import { useTemporaryAppDirs } from '../testUtils/appDirs';
import { setUpTestDBConnection } from '../testUtils/db';
import { mockLoggerToken } from '../testUtils/logging';
import { CONTROL_API_PREFIX } from './control';
import { makeServer } from './index';

setUpTestDBConnection();
useTemporaryAppDirs();
mockLoggerToken();

describe('disableCors', () => {
  test('Request with Origin header should be refused', async () => {
    const fastify = await makeServer();

    const response = await fastify.inject({ url: '/', headers: { origin: 'https://example.com' } });

    expect(response.statusCode).toEqual(400);
    expect(JSON.parse(response.body)).toHaveProperty('message', 'CORS requests are forbidden');
  });

  test('Request with Origin header should be allowed if it belongs to control API', async () => {
    const fastify = await makeServer();

    const response = await fastify.inject({ url: `${CONTROL_API_PREFIX}/foo` });

    expect(response.statusCode).toEqual(404);
  });

  test('Request without Origin header should be allowed', async () => {
    const fastify = await makeServer();

    const response = await fastify.inject({ url: '/' });

    expect(response.statusCode).toEqual(404);
  });
});
