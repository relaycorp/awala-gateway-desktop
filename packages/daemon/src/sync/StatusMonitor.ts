import { EventEmitter } from 'events';
import pipe from 'it-pipe';
import { PassThrough } from 'stream';
import { source } from 'stream-to-it';
import { Inject, Service } from 'typedi';

import { CourierConnectionStatus, CourierSync } from './courierSync/CourierSync';

export enum ConnectionStatus {
  CONNECTED_TO_PUBLIC_GATEWAY = 'CONNECTED_TO_PUBLIC_GATEWAY',
  CONNECTED_TO_COURIER = 'CONNECTED_TO_COURIER',
  DISCONNECTED = 'DISCONNECTED',
}

@Service()
export class StatusMonitor {
  // tslint:disable-next-line:readonly-keyword
  private started: boolean = false;

  // tslint:disable-next-line:readonly-keyword
  private lastStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;

  private readonly events = new EventEmitter();

  constructor(@Inject() protected courierSync: CourierSync) {}

  public getLastStatus(): ConnectionStatus {
    return this.lastStatus;
  }

  public setLastStatus(status: ConnectionStatus): void {
    if (status !== this.lastStatus) {
      // tslint:disable-next-line:no-object-mutation
      this.lastStatus = status;

      this.events.emit('change', status);
    }
  }

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error('Monitor already started');
    }
    // tslint:disable-next-line:no-object-mutation
    this.started = true;

    // tslint:disable-next-line:no-this-assignment
    const monitor = this;
    async function reflectCourierConnectionStatus(
      statuses: AsyncIterable<CourierConnectionStatus>,
    ): Promise<void> {
      for await (const status of statuses) {
        const monitorStatus =
          status === CourierConnectionStatus.CONNECTED
            ? ConnectionStatus.CONNECTED_TO_COURIER
            : ConnectionStatus.DISCONNECTED;
        monitor.setLastStatus(monitorStatus);
      }
    }
    await pipe(this.courierSync.streamStatus(), reflectCourierConnectionStatus);
  }

  public async *streamStatus(): AsyncIterable<ConnectionStatus> {
    const stream = new PassThrough({ objectMode: true });
    const streamNewStatus = (status: ConnectionStatus) => {
      stream.write(status);
    };
    this.events.on('change', streamNewStatus);

    yield this.lastStatus;
    try {
      yield* await source(stream);
    } finally {
      this.events.removeListener('change', streamNewStatus);
    }
  }
}
