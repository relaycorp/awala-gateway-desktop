import { IPCMessage } from '../ipc';
import { CourierSyncStage } from './index';

export interface CourierSyncStageNotification extends IPCMessage {
  readonly stage: CourierSyncStage;
  readonly type: 'stage';
}

export interface ParcelCollectionNotification extends IPCMessage {
  readonly parcelKey: string;
  readonly recipientAddress: string;
  readonly type: 'parcelCollection';
}
