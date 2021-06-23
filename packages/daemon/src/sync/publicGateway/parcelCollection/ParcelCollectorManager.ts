import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex, PassThrough } from 'stream';
import { source } from 'stream-to-it';
import { Inject, Service } from 'typedi';

import { LOGGER } from '../../../tokens';
import { fork } from '../../../utils/subprocess/child';
import { PublicGatewayCollectionStatus } from '../PublicGatewayCollectionStatus';

@Service()
export class ParcelCollectorManager {
  // tslint:disable-next-line:readonly-keyword
  protected subprocess: Duplex | null = null;

  constructor(@Inject(LOGGER) protected logger: Logger) {}

  public async start(): Promise<void> {
    if (this.subprocess?.destroyed === false) {
      this.logger.warn('Ignored attempt to start parcel collection subprocess a second time');
    } else {
      // tslint:disable-next-line:no-object-mutation
      this.subprocess = await fork('parcel-collection');

      this.logger.info('Started parcel collection subprocess');
    }
  }

  public async restart(): Promise<void> {
    this.subprocess?.destroy();
    return new Promise((resolve) => {
      setImmediate(async () => {
        await this.start();
        resolve();
      });
    });
  }

  public async *streamStatus(): AsyncIterable<PublicGatewayCollectionStatus> {
    if (!this.subprocess) {
      throw new Error('Parcel collection subprocess is not yet running');
    }
    const readonlySubprocessStream = new PassThrough({ objectMode: true });
    this.subprocess.pipe(readonlySubprocessStream);
    try {
      yield* await pipe(
        source(readonlySubprocessStream),
        async function* (messages): AsyncIterable<PublicGatewayCollectionStatus> {
          for await (const message of messages) {
            if (message?.type !== 'status') {
              continue;
            }
            yield message.status === 'connected'
              ? PublicGatewayCollectionStatus.CONNECTED
              : PublicGatewayCollectionStatus.DISCONNECTED;
          }
        },
      );
    } finally {
      this.subprocess.unpipe(readonlySubprocessStream);
    }
  }
}
