import { sleep } from './_utils';

export enum ConnectionStatus {
  CONNECTED_TO_PUBLIC_GATEWAY,
  CONNECTED_TO_COURIER,
  DISCONNECTED_FROM_PUBLIC_GATEWAY,
  DISCONNECTED_FROM_ALL,
}

export interface ConnectionStatusPoller {
  readonly promise: AsyncIterable<ConnectionStatus>;
  readonly abort: () => void;
}

/**
 * Wrapper for status polling that exposes an abort method
 *
 */
export function pollConnectionStatus(): ConnectionStatusPoller {
  const controller = new AbortController();
  return {
    abort: () => {
      controller.abort();
    },
    promise: _pollConnectionStatus(controller.signal),
  };
}

async function* _pollConnectionStatus(signal: AbortSignal): AsyncIterable<ConnectionStatus> {
  if (signal.aborted) {
    return;
  }
  yield ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY;
  await sleep(3);

  if (signal.aborted) {
    return;
  }
  yield ConnectionStatus.CONNECTED_TO_COURIER;
  await sleep(5);

  if (signal.aborted) {
    return;
  }
  yield ConnectionStatus.DISCONNECTED_FROM_PUBLIC_GATEWAY;
  await sleep(5);

  if (signal.aborted) {
    return;
  }
  yield ConnectionStatus.DISCONNECTED_FROM_ALL;
  await sleep(2);
}
