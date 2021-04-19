import { EventEmitter } from 'events';
import pipe from 'it-pipe';
import { PassThrough } from 'stream';
import { source } from 'stream-to-it';
import { Inject, Service } from 'typedi';

import { CourierConnectionStatus, CourierSync } from './courierSync/CourierSync';
import { GatewayRegistrar } from './publicGateway/GatewayRegistrar';

export enum ConnectionStatus {
  CONNECTED_TO_PUBLIC_GATEWAY = 'CONNECTED_TO_PUBLIC_GATEWAY',
  CONNECTED_TO_COURIER = 'CONNECTED_TO_COURIER',
  DISCONNECTED = 'DISCONNECTED',
  UNREGISTERED = 'UNREGISTERED',
}

@Service()
export class StatusMonitor {
  // tslint:disable-next-line:readonly-keyword
  private started: boolean = false;

  // tslint:disable-next-line:readonly-keyword
  private lastStatus: ConnectionStatus | null = null;

  private readonly events = new EventEmitter();

  constructor(
    @Inject() protected courierSync: CourierSync,
    @Inject() protected registrar: GatewayRegistrar,
  ) {}

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

    const initialStatus = (await this.registrar.isRegistered())
      ? ConnectionStatus.DISCONNECTED
      : ConnectionStatus.UNREGISTERED;
    this.setLastStatus(initialStatus);

    const setMonitorStatus = async (statuses: AsyncIterable<ConnectionStatus>) => {
      for await (const status of statuses) {
        this.setLastStatus(status);
      }
    };

    const registrar = this.registrar;
    async function* reflectCourierConnectionStatus(
      statuses: AsyncIterable<CourierConnectionStatus>,
    ): AsyncIterable<ConnectionStatus> {
      for await (const status of statuses) {
        if (await registrar.isRegistered()) {
          const monitorStatus =
            status === CourierConnectionStatus.CONNECTED
              ? ConnectionStatus.CONNECTED_TO_COURIER
              : ConnectionStatus.DISCONNECTED;
          yield monitorStatus;
        } else {
          yield ConnectionStatus.UNREGISTERED;
        }
      }
    }
    await pipe(this.courierSync.streamStatus(), reflectCourierConnectionStatus, setMonitorStatus);
  }

  public async *streamStatus(): AsyncIterable<ConnectionStatus> {
    const stream = new PassThrough({ objectMode: true });
    const streamNewStatus = (status: ConnectionStatus) => {
      stream.write(status);
    };
    this.events.on('change', streamNewStatus);

    if (this.lastStatus) {
      yield this.lastStatus;
    }
    try {
      yield* await source(stream);
    } finally {
      this.events.removeListener('change', streamNewStatus);
    }
  }

  /**
   * Reset state between unit tests.
   *
   * TODO: Refactor to avoid doing this
   */
  public _reset(): void {
    // tslint:disable-next-line:no-object-mutation
    this.started = false;
    // tslint:disable-next-line:no-object-mutation
    this.lastStatus = null;
  }
}
