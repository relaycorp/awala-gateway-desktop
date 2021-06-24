import { EventEmitter } from 'events';
import pipe from 'it-pipe';
import { Logger } from 'pino';
import { Duplex, PassThrough } from 'stream';
import { source } from 'stream-to-it';
import { Inject, Service } from 'typedi';

import { LOGGER } from '../../../tokens';
import { fork } from '../../../utils/subprocess/child';
import { PublicGatewayCollectionStatus } from '../PublicGatewayCollectionStatus';
import { ParcelCollectorMessage } from './messaging';

@Service()
export class ParcelCollectorManager {
  // tslint:disable-next-line:readonly-keyword
  protected subprocess: Duplex | null = null;

  protected readonly events = new EventEmitter();

  constructor(@Inject(LOGGER) protected logger: Logger) {}

  public start(): void {
    if (this.subprocess?.destroyed === false) {
      this.logger.warn('Ignored attempt to start parcel collection subprocess a second time');
    } else {
      // tslint:disable-next-line:no-object-mutation
      this.subprocess = fork('parcel-collection');

      this.events.emit('started');

      this.logger.info('Started parcel collection subprocess');
    }
  }

  public async restart(): Promise<void> {
    if (this.subprocess?.destroyed === false) {
      this.subprocess.destroy();

      return new Promise((resolve) => {
        setImmediate(() => {
          this.start();
          resolve();
        });
      });
    }
  }

  public async *streamStatus(): AsyncIterable<PublicGatewayCollectionStatus> {
    yield* await pipe(
      this.streamMessages(),
      async function* (
        messages: AsyncIterable<ParcelCollectorMessage>,
      ): AsyncIterable<PublicGatewayCollectionStatus> {
        for await (const message of messages) {
          if (message.type === 'status') {
            yield message.status === 'connected'
              ? PublicGatewayCollectionStatus.CONNECTED
              : PublicGatewayCollectionStatus.DISCONNECTED;
          }
        }
      },
    );
  }

  public async *watchCollectionsForRecipients(
    recipientAddresses: readonly string[],
  ): AsyncIterable<string> {
    yield* await pipe(
      this.streamMessages(),
      async function* (messages: AsyncIterable<ParcelCollectorMessage>): AsyncIterable<string> {
        for await (const message of messages) {
          if (
            message.type === 'parcelCollection' &&
            recipientAddresses.includes(message.recipientAddress)
          ) {
            yield message.parcelKey;
          }
        }
      },
    );
  }

  private async *streamMessages(): AsyncIterable<ParcelCollectorMessage> {
    // Continue streaming across restarts
    while (true) {
      await this.waitForSubprocessToBeRunning();

      // Get a reference to the subprocess to ensure we're working on the same one across restarts
      const subprocess = this.subprocess!;

      const readonlySubprocessStream = new PassThrough({ objectMode: true });
      subprocess.pipe(readonlySubprocessStream);
      const endReadonlyStream = () => {
        readonlySubprocessStream.end();
      };
      subprocess.once('close', endReadonlyStream);
      try {
        yield* await source(readonlySubprocessStream);
      } finally {
        subprocess.removeListener('close', endReadonlyStream);
        subprocess.unpipe(readonlySubprocessStream);
      }
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
