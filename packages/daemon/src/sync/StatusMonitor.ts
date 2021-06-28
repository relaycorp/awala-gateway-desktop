import { EventEmitter } from 'events';
import pipe from 'it-pipe';
import { PassThrough } from 'stream';
import { source } from 'stream-to-it';
import { Inject, Service } from 'typedi';

import { CourierConnectionStatus, CourierSyncManager } from './courierSync/CourierSyncManager';
import { GatewayRegistrar } from './publicGateway/GatewayRegistrar';
import { ParcelCollectorManager } from './publicGateway/parcelCollection/ParcelCollectorManager';
import { PublicGatewayCollectionStatus } from './publicGateway/PublicGatewayCollectionStatus';

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
    @Inject() protected courierSync: CourierSyncManager,
    @Inject() protected parcelCollectorManager: ParcelCollectorManager,
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

    let isConnectedToPublicGateway = false;
    let isConnectedToCourier = false;

    // tslint:disable-next-line:no-this-assignment
    const monitor = this;
    async function updateStatus(): Promise<void> {
      let newStatus: ConnectionStatus;
      if (isConnectedToPublicGateway) {
        newStatus = ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY;
      } else {
        const isRegistered = await monitor.registrar.isRegistered();
        if (isRegistered) {
          newStatus = isConnectedToCourier
            ? ConnectionStatus.CONNECTED_TO_COURIER
            : ConnectionStatus.DISCONNECTED;
        } else {
          newStatus = ConnectionStatus.UNREGISTERED;
        }
      }
      monitor.setLastStatus(newStatus);
    }

    await updateStatus();

    async function reflectCourierConnectionStatus(
      statuses: AsyncIterable<CourierConnectionStatus>,
    ): Promise<void> {
      for await (const status of statuses) {
        isConnectedToCourier = status === CourierConnectionStatus.CONNECTED;
        await updateStatus();
      }
    }
    async function reflectPublicGatewayConnectionStatus(
      statuses: AsyncIterable<PublicGatewayCollectionStatus>,
    ): Promise<void> {
      for await (const status of statuses) {
        isConnectedToPublicGateway = status === PublicGatewayCollectionStatus.CONNECTED;
        await updateStatus();
      }
    }
    await Promise.all([
      pipe(this.courierSync.streamStatus(), reflectCourierConnectionStatus),
      pipe(this.parcelCollectorManager.streamStatus(), reflectPublicGatewayConnectionStatus),
    ]);
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
