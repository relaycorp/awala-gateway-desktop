import abortable from 'abortable-iterator';
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
export function pollConnectionStatus(token: string): ConnectionStatusPoller {
  const controller = new AbortController();
  const promise = abortable(_pollConnectionStatus(token), controller.signal, { returnOnAbort: true });
  return {
    abort: () => {
      controller.abort();
    },
    promise,
  };
}

async function* _pollConnectionStatus(token: string): AsyncIterable<ConnectionStatus> {
  if (token === '') {
    return Promise.resolve(ConnectionStatus.DISCONNECTED_FROM_ALL);
  }
  yield ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY;
  await sleep(3);

  yield ConnectionStatus.CONNECTED_TO_COURIER;
  await sleep(5);

  yield ConnectionStatus.DISCONNECTED_FROM_PUBLIC_GATEWAY;
  await sleep(5);

  yield ConnectionStatus.DISCONNECTED_FROM_ALL;
  await sleep(2);
}
