import { IPCMessage } from '../../ipc';

export interface ParcelCollectionNotification extends IPCMessage {
  readonly parcelKey: string;
  readonly recipientId: string;
  readonly type: 'parcelCollection';
}

export interface ParcelCollectorStatus extends IPCMessage {
  readonly status: 'connected' | 'disconnected';
  readonly type: 'status';
}

export type ParcelCollectorMessage = ParcelCollectionNotification | ParcelCollectorStatus;
