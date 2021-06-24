import { IPCMessage } from '../../ipc';

export interface ParcelCollectionNotification extends IPCMessage {
  readonly parcelKey: string;
  readonly recipientAddress: string;
  readonly type: 'parcelCollection';
}

export interface ParcelCollectorStatus extends IPCMessage {
  readonly status: 'connected' | 'disconnected';
  readonly type: 'status';
}
