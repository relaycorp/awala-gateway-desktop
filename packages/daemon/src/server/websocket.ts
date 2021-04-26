import { Logger } from 'pino';
import { Duplex } from 'stream';
import WebSocket, { createWebSocketStream, Server } from 'ws';
import { getBearerTokenFromAuthHeader } from '../utils/auth';

export type WebsocketServerFactory = (logger: Logger, controlAuthToken: string) => Server;

export function makeWebSocketServer(
  handler: (connectionStream: Duplex, socket: WebSocket) => void,
  logger: Logger,
  authToken?: string,
): WebSocket.Server {
  const wsServer = new WebSocket.Server({
    clientTracking: false,
    noServer: true,
  });

  const isAuthRequired = !!authToken;

  wsServer.on('connection', (socket, request) => {
    const bearerToken = getBearerTokenFromAuthHeader(request.headers.authorization);
    if (isAuthRequired && authToken !== bearerToken) {
      logger.info('Refusing unauthenticated request');
      socket.close(1008, 'Authentication is required');
      return;
    }

    if (!isAuthRequired && request.headers.origin) {
      logger.info('Refusing CORS request');
      socket.close(1008, 'CORS requests are disabled');
      return;
    }

    const stream = createWebSocketStream(socket);
    handler(stream, socket);
  });

  return wsServer;
}
