import { MAX_RAMF_MESSAGE_LENGTH } from '@relaycorp/relaynet-core';
import { fastify, FastifyInstance, FastifyPluginCallback } from 'fastify';
import { Server } from 'http';
import { Logger } from 'pino';

import controlRoutes from './control';
import makeConnectionStatusServer, {
  PATH as CONNECTION_STATUS_PATH,
} from './control/connectionStatus';
import { disableCors } from './cors';
import RouteOptions from './RouteOptions';

const ROUTES: ReadonlyArray<FastifyPluginCallback<RouteOptions>> = [controlRoutes];

const SERVER_PORT = 13276;
const SERVER_HOST = '127.0.0.1';

export async function makeServer(logger: Logger): Promise<FastifyInstance> {
  const server = fastify({
    bodyLimit: MAX_RAMF_MESSAGE_LENGTH,
    logger,
  });

  await server.addHook('onRequest', disableCors);

  await Promise.all(ROUTES.map((route) => server.register(route)));

  registerWebsocketEndpoints(logger, server);

  await server.ready();

  return server;
}

export async function runServer(fastifyInstance: FastifyInstance): Promise<void> {
  await fastifyInstance.listen({ host: SERVER_HOST, port: SERVER_PORT });
}

function registerWebsocketEndpoints(logger: Logger, server: FastifyInstance<Server>): void {
  const connectionStatusWebsocketServer = makeConnectionStatusServer(logger);
  server.server.on('upgrade', (request, socket, headers) => {
    if (request.url === CONNECTION_STATUS_PATH) {
      connectionStatusWebsocketServer.handleUpgrade(request, socket, headers, (websocket) => {
        connectionStatusWebsocketServer.emit('connection', websocket, request);
      });
    } else {
      socket.destroy();
    }
  });
}
