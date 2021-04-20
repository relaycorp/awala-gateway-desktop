import { Logger } from 'pino';
import { Duplex } from 'stream';
import WebSocket, { createWebSocketStream, Server } from 'ws';

export type WebsocketServerFactory = (logger: Logger) => Server;

export function makeWebSocketServer(
  handler: (connectionStream: Duplex, socket: WebSocket) => void,
  logger: Logger,
): WebSocket.Server {
  const wsServer = new WebSocket.Server({
    clientTracking: false,
    noServer: true,
  });

  wsServer.on('connection', (socket, request) => {
    if (request.headers.origin) {
      logger.info('Refusing CORS request');
      socket.close(1008, 'CORS requests are disabled');
      return;
    }

    const stream = createWebSocketStream(socket);
    handler(stream, socket);
  });

  return wsServer;
}
