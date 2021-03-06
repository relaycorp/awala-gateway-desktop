import PrivateGatewayError from '../PrivateGatewayError';
import { sleep } from './_utils';

export enum CourierSyncStatus {
  COLLECTING_CARGO,
  WAITING,
  DELIVERING_CARGO,
}

export class CourierSyncError extends PrivateGatewayError {}

/**
 * Initialize synchronization with courier and wait until it completes.
 *
 * This method will stream the current status of the synchronization.
 *
 * @throws CourierSyncError if the synchronization fails at any point
 */
export async function* synchronizeWithCourier(): AsyncIterable<CourierSyncStatus> {
  yield CourierSyncStatus.COLLECTING_CARGO;
  await sleep(5);

  yield CourierSyncStatus.WAITING;
  await sleep(5);

  yield CourierSyncStatus.DELIVERING_CARGO;
  await sleep(5);
}
