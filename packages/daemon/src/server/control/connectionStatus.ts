import AbortController from 'abort-controller';
import { source as makeSourceAbortable } from 'abortable-iterator';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { sink } from 'stream-to-it';
import { Container } from 'typedi';
import { Server } from 'ws';

import { StatusMonitor } from '../../sync/StatusMonitor';
import { makeWebSocketServer } from '../websocket';

export const PATH = '/_control/sync-status';

export default function makeConnectionStatusServer(logger: Logger, authToken: string): Server {
  const statusMonitor = Container.get(StatusMonitor);

  return makeWebSocketServer(
    async (connectionStream, socket) => {
      const peerClosureController = new AbortController();
      socket.once('close', () => {
        peerClosureController.abort();
        socket.close(1000);
      });

      const abortableStatusStream = makeSourceAbortable(
        statusMonitor.streamStatus(),
        peerClosureController.signal,
        { returnOnAbort: true },
      );
      await pipe(abortableStatusStream, sink(connectionStream));
    },
    logger,
    authToken,
  );
}
