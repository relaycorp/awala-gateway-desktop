import { MAX_RAMF_MESSAGE_LENGTH } from '@relaycorp/relaynet-core';
import { fastify, FastifyInstance, FastifyPluginCallback } from 'fastify';
import { Server } from 'http';
import { Container } from 'typedi';
import { URL } from 'url';
import uuid from 'uuid-random';
import { Server as WSServer } from 'ws';

import { LOGGER } from '../tokens';
import controlRoutes from './control';
import makeConnectionStatusServer, {
  PATH as CONNECTION_STATUS_PATH,
} from './control/connectionStatus';
import makeCourierSyncServer, { PATH as COURIER_SYNC_PATH } from './control/courierSync';
import { disableCors } from './cors';
import poWebRoutes from './poweb';
import makeParcelCollectionServer, {
  PATH as POWEB_PARCEL_COLLECTION,
} from './poweb/parcelCollection';
import RouteOptions from './RouteOptions';
import { WebsocketServerFactory } from './websocket';
import { UnregisteredGatewayError } from '../errors';

const ROUTES: ReadonlyArray<FastifyPluginCallback<RouteOptions>> = [controlRoutes, poWebRoutes];

const SERVER_PORT = 13276;
const SERVER_HOST = '127.0.0.1';

const WS_SERVER_BY_PATH: { readonly [key: string]: WebsocketServerFactory } = {
  [CONNECTION_STATUS_PATH]: makeConnectionStatusServer,
  [COURIER_SYNC_PATH]: makeCourierSyncServer,
  [POWEB_PARCEL_COLLECTION]: makeParcelCollectionServer,
};

export async function makeServer(authToken?: string): Promise<FastifyInstance> {
  const logger = Container.get(LOGGER);
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

  registerWebsocketEndpoints(server, controlAuthToken);

  await server.ready();

  return server;
}

export async function runServer(fastifyInstance: FastifyInstance): Promise<void> {
  await fastifyInstance.listen({ host: SERVER_HOST, port: SERVER_PORT });
}

function registerWebsocketEndpoints(
  server: FastifyInstance<Server>,
  controlAuthToken: string,
): void {
  const serversByPath: { readonly [k: string]: WSServer } = Object.entries(
    WS_SERVER_BY_PATH,
  ).reduce((acc, [path, factory]) => ({ ...acc, [path]: factory(controlAuthToken) }), {});

  server.server.on('upgrade', (request, socket, headers) => {
    let url: URL;
    const urlString = `https://127.0.0.0.1${request.url!}`;
    try {
      // Can't pass the base as a second argument to `URL` because it breaks on macOS (Node.js 6).
      url = new URL(urlString);
    } catch (err) {
      throw new UnregisteredGatewayError(err as Error, `Failed to parse ${urlString}`);
    }
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
