import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { source } from 'stream-to-it';
import { Service } from 'typedi';

export enum ConnectionStatus {
  CONNECTED_TO_PUBLIC_GATEWAY = 'CONNECTED_TO_PUBLIC_GATEWAY',
  CONNECTED_TO_COURIER = 'CONNECTED_TO_COURIER',
  DISCONNECTED_FROM_ALL = 'DISCONNECTED_FROM_ALL',
}

@Service()
export class StatusMonitor {
  // tslint:disable-next-line:readonly-keyword
  private lastStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED_FROM_ALL;

  private readonly events = new EventEmitter();

  public getLastStatus(): ConnectionStatus {
    return this.lastStatus;
  }

  public setLastStatus(status: ConnectionStatus): void {
    // tslint:disable-next-line:no-object-mutation
    this.lastStatus = status;

    this.events.emit('change', status);
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
