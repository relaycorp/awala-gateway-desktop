import { MAX_RAMF_MESSAGE_LENGTH } from '@relaycorp/relaynet-core';
import { fastify, FastifyInstance, FastifyPluginCallback } from 'fastify';
import { Server } from 'http';
import { Logger } from 'pino';
import uuid from 'uuid-random';
import { Server as WSServer } from 'ws';

import controlRoutes from './control';
import makeConnectionStatusServer, {
  PATH as CONNECTION_STATUS_PATH,
} from './control/connectionStatus';
import makeCourierSyncServer, { PATH as COURIER_SYNC_PATH } from './control/courierSync';
import { disableCors } from './cors';
import poWebRoutes from './poweb';
import RouteOptions from './RouteOptions';
import { WebsocketServerFactory } from './websocket';

const ROUTES: ReadonlyArray<FastifyPluginCallback<RouteOptions>> = [controlRoutes, poWebRoutes];

const SERVER_PORT = 13276;
const SERVER_HOST = '127.0.0.1';

const WS_SERVER_BY_PATH: { readonly [key: string]: WebsocketServerFactory } = {
  [CONNECTION_STATUS_PATH]: makeConnectionStatusServer,
  [COURIER_SYNC_PATH]: makeCourierSyncServer,
};

export async function makeServer(logger: Logger, authToken?: string): Promise<FastifyInstance> {
  const server = fastify({
    bodyLimit: MAX_RAMF_MESSAGE_LENGTH,
    logger,
  });

  await server.addHook('onRequest', disableCors);

  const controlAuthToken = authToken ?? uuid();
  if (process.send) {
    process.send({ type: 'controlAuthToken', value: controlAuthToken });
  }

  const options: RouteOptions = { controlAuthToken };
  await Promise.all(ROUTES.map((route) => server.register(route, options)));

  registerWebsocketEndpoints(server, logger, controlAuthToken);

  await server.ready();

  return server;
}

export async function runServer(fastifyInstance: FastifyInstance): Promise<void> {
  await fastifyInstance.listen({ host: SERVER_HOST, port: SERVER_PORT });
}

function registerWebsocketEndpoints(
  server: FastifyInstance<Server>,
  logger: Logger,
  controlAuthToken: string,
): void {
  const serversByPath: { readonly [k: string]: WSServer } = Object.entries(
    WS_SERVER_BY_PATH,
  ).reduce((acc, [path, factory]) => ({ ...acc, [path]: factory(logger, controlAuthToken) }), {});

  server.server.on('upgrade', (request, socket, headers) => {
    const url = new URL(request.url, 'https://127.0.0.0.1');
    const wsServer: WSServer | undefined = serversByPath[url.pathname];
    if (wsServer) {
      wsServer.handleUpgrade(request, socket, headers, (websocket) => {
        wsServer.emit('connection', websocket, request);
      });
    } else {
      socket.destroy();
    }
  });
}
