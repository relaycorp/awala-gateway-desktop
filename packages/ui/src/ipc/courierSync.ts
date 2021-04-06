import PrivateGatewayError from '../PrivateGatewayError';
import { sleep } from './_utils';
import abortable from 'abortable-iterator';

export enum CourierSyncStatus {
  COLLECTING_CARGO,
  WAITING,
  DELIVERING_CARGO,
  COMPLETE,
}

export class CourierSyncError extends PrivateGatewayError {}

export interface CourierSync {
  readonly promise: AsyncIterable<CourierSyncStatus>;
  readonly abort: () => void;
}

/**
 * Wrapper for synchronization that exposes an abort method
 *
 */
export function synchronizeWithCourier(): CourierSync {
  const controller = new AbortController();
  const promise = abortable(_synchronizeWithCourier(), controller.signal, { returnOnAbort: true });
  return {
    abort: () => {
      controller.abort();
    },
    promise,
  };
}

/**
 * Initialize synchronization with courier and wait until it completes.
 *
 * This method will stream the current status of the synchronization.
 *
 * @throws CourierSyncError if the synchronization fails at any point
 */
async function* _synchronizeWithCourier(): AsyncIterable<CourierSyncStatus> {
  yield CourierSyncStatus.COLLECTING_CARGO;
  await sleep(5);

  yield CourierSyncStatus.WAITING;
  await sleep(5);

  yield CourierSyncStatus.DELIVERING_CARGO;
  await sleep(5);

  yield CourierSyncStatus.COMPLETE;
}
