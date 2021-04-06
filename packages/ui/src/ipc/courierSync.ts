import PrivateGatewayError from '../PrivateGatewayError';
import { sleep } from './_utils';

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
  return {
    abort: () => {
      controller.abort();
    },
    promise: _synchronizeWithCourier(controller.signal),
  };
}

/**
 * Initialize synchronization with courier and wait until it completes.
 *
 * This method will stream the current status of the synchronization.
 *
 * @throws CourierSyncError if the synchronization fails at any point
 */
async function* _synchronizeWithCourier(signal: AbortSignal): AsyncIterable<CourierSyncStatus> {
  if (signal.aborted) {
    return;
  }
  yield CourierSyncStatus.COLLECTING_CARGO;
  await sleep(5);

  if (signal.aborted) {
    return;
  }
  yield CourierSyncStatus.WAITING;
  await sleep(5);

  if (signal.aborted) {
    return;
  }
  yield CourierSyncStatus.DELIVERING_CARGO;
  await sleep(5);

  if (signal.aborted) {
    return;
  }
  yield CourierSyncStatus.COMPLETE;
}
