import { EventEmitter } from 'events';
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

  protected readonly events = new EventEmitter();

  constructor(@Inject(LOGGER) protected logger: Logger) {}

  public async start(): Promise<void> {
    if (this.subprocess?.destroyed === false) {
      this.logger.warn('Ignored attempt to start parcel collection subprocess a second time');
    } else {
      // tslint:disable-next-line:no-object-mutation
      this.subprocess = await fork('parcel-collection');

      this.events.emit('started');

      this.logger.info('Started parcel collection subprocess');
    }
  }

  public async restart(): Promise<void> {
    if (this.subprocess?.destroyed === false) {
      this.subprocess.destroy();

      return new Promise((resolve) => {
        setImmediate(async () => {
          await this.start();
          resolve();
        });
      });
    }
  }

  public async *streamStatus(): AsyncIterable<PublicGatewayCollectionStatus> {
    while (true) {
      await this.waitForSubprocessToBeRunning();
      yield* await streamStatus(this.subprocess!);
    }
  }

  private async waitForSubprocessToBeRunning(): Promise<void> {
    if (!this.subprocess || this.subprocess.destroyed) {
      // The subprocess either hasn't been started or it's in the middle of a restart
      await new Promise((resolve) => {
        this.events.once('started', resolve);
      });
    }
  }
}

async function* streamStatus(subprocess: Duplex): AsyncIterable<PublicGatewayCollectionStatus> {
  const readonlySubprocessStream = new PassThrough({ objectMode: true });
  subprocess.pipe(readonlySubprocessStream);
  const endReadonlyStream = () => {
    readonlySubprocessStream.end({ type: 'status', status: 'disconnected' });
  };
  subprocess.once('close', endReadonlyStream);
  try {
    yield* await pipe(source(readonlySubprocessStream), reportStatusChanges);
  } finally {
    subprocess.unpipe(readonlySubprocessStream);
    subprocess.removeListener('close', endReadonlyStream);
  }
}

async function* reportStatusChanges(
  messages: AsyncIterable<any>,
): AsyncIterable<PublicGatewayCollectionStatus> {
  for await (const message of messages) {
    if (message.type !== 'status') {
      continue;
    }
    yield message.status === 'connected'
      ? PublicGatewayCollectionStatus.CONNECTED
      : PublicGatewayCollectionStatus.DISCONNECTED;
  }
}
