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
  SERVER_ERROR = 1011,
}

export interface WebSocketServerOptions {
  readonly authToken: string;
  readonly pingFrequencySeconds: number;
}

export function makeWebSocketServer(
  handler: (
    connectionStream: Duplex,
    socket: WebSocket,
    headers: IncomingHttpHeaders,
  ) => Promise<void>,
  options: Partial<WebSocketServerOptions> = {},
): WebSocket.Server {
  const wsServer = new WebSocket.Server({
    clientTracking: false,
    noServer: true,
  });

  const isAuthRequired = !!options.authToken;
  const logger = Container.get(LOGGER);

  wsServer.on('connection', async (socket, request) => {
    socket.once('close', (code, reason) => {
      logger.debug({ code, reason }, 'Closing connection');
    });

    const url = new URL(request.url!!, 'http://127.0.0.1');
    const requestToken = url.searchParams.get('auth');
    if (isAuthRequired && options.authToken !== requestToken) {
      logger.info('Refusing unauthenticated request');
      socket.close(WebSocketCode.VIOLATED_POLICY, 'Authentication is required');
      return;
    }

    if (!isAuthRequired && request.headers.origin) {
      logger.info('Refusing CORS request');
      socket.close(WebSocketCode.VIOLATED_POLICY, 'CORS requests are disabled');
      return;
    }

    if (options.pingFrequencySeconds) {
      const pingIntervalId = setInterval(() => {
        logger.trace('Sending ping to client');
        socket.ping();
      }, options.pingFrequencySeconds * 1_000);
      socket.once('close', () => {
        clearInterval(pingIntervalId);
      });
    }

    const stream = createWebSocketStream(socket);
    try {
      await handler(stream, socket, request.headers);
    } catch (err) {
      socket.close(WebSocketCode.SERVER_ERROR, 'Internal server error');
      logger.error({ err }, 'Unhandled exception in WebSocket server handler');
    }
  });

  return wsServer;
}
