import pipe from 'it-pipe';
import { Logger } from 'pino';
import { PassThrough } from 'stream';
import { sink } from 'stream-to-it';
import { Container } from 'typedi';
import { Server } from 'ws';

import { CourierSync } from '../../sync/courierSync/CourierSync';
import {
  DisconnectedFromCourierError,
  UnregisteredGatewayError,
} from '../../sync/courierSync/errors';
import { makeWebSocketServer } from '../websocket';
import { CONTROL_API_PREFIX } from './index';

export const PATH = `${CONTROL_API_PREFIX}/courier-sync`;

export default function makeCourierSyncServer(logger: Logger): Server {
  return makeWebSocketServer(
    async (connectionStream, socket) => {
      const courierSync = Container.get(CourierSync);

      // Wrap the WS writable stream to prevent it from closing with a 1006:
      // https://github.com/websockets/ws/issues/1811
      const sinkWrapper = new PassThrough({
        final(): void {
          socket.close(1000);
        },
        objectMode: true,
      });
      sinkWrapper.pipe(connectionStream);

      try {
        await pipe(courierSync.sync(), sink(sinkWrapper));
      } catch (err) {
        let closeCode: number;
        let closeReason: string;
        if (err instanceof UnregisteredGatewayError) {
          logger.warn('Aborting courier sync because gateway is unregistered');
          closeCode = 4000;
          closeReason = 'Gateway is not yet registered';
        } else if (err instanceof DisconnectedFromCourierError) {
          logger.warn('Aborting courier sync because device is not connected to a courier');
          closeCode = 4001;
          closeReason = 'Device is not connected to a courier';
        } else {
          logger.error({ err }, 'Unexpected error when syncing with courier');
          closeCode = 1011;
          closeReason = 'Internal server error';
        }
        socket.close(closeCode, closeReason);
        return;
      }
    },
    logger,
    true,
  );
}
