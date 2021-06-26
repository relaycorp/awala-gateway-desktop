import { IncomingHttpHeaders } from 'http';
import { Duplex } from 'stream';
import { Container } from 'typedi';
import WebSocket, { createWebSocketStream, Server } from 'ws';

import { LOGGER } from '../tokens';

export type WebsocketServerFactory = (controlAuthToken: string) => Server;

export enum WebSocketCode {
  NORMAL = 1000,
  CANNOT_ACCEPT = 1003,
  VIOLATED_POLICY = 1008,
}

export function makeWebSocketServer(
  handler: (connectionStream: Duplex, socket: WebSocket, headers: IncomingHttpHeaders) => void,
  authToken?: string,
): WebSocket.Server {
  const wsServer = new WebSocket.Server({
    clientTracking: false,
    noServer: true,
  });

  const isAuthRequired = !!authToken;
  const logger = Container.get(LOGGER);

  wsServer.on('connection', (socket, request) => {
    const url = new URL(request.url!!, 'http://127.0.0.1');
    const requestToken = url.searchParams.get('auth');
    if (isAuthRequired && authToken !== requestToken) {
      logger.info('Refusing unauthenticated request');
      socket.close(WebSocketCode.VIOLATED_POLICY, 'Authentication is required');
      return;
    }

    if (!isAuthRequired && request.headers.origin) {
      logger.info('Refusing CORS request');
      socket.close(WebSocketCode.VIOLATED_POLICY, 'CORS requests are disabled');
      return;
    }

    const stream = createWebSocketStream(socket);
    handler(stream, socket, request.headers);
  });

  return wsServer;
}
