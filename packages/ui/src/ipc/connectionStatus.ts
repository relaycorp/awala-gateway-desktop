import AbortController from 'abort-controller';
import abortable from 'abortable-iterator';
import { connect } from 'it-ws';

export enum ConnectionStatus {
  CONNECTED_TO_PUBLIC_GATEWAY,
  CONNECTED_TO_COURIER,
  DISCONNECTED_FROM_PUBLIC_GATEWAY,
  DISCONNECTED,
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
  const promise = abortable(_pollConnectionStatus(token), controller.signal, {
    returnOnAbort: true,
  });
  return {
    abort: () => {
      controller.abort();
    },
    promise,
  };
}

async function* _pollConnectionStatus(token: string): AsyncIterable<ConnectionStatus> {
  const WS_URL = 'ws://127.0.0.1:13276/_control/sync-status?authorization=Bearer%20' + token;
  const stream = connect( WS_URL, { binary: true });
  for await (const buffer of stream.source) {
    const name = buffer.toString();
    switch (name) {
      case 'CONNECTED_TO_PUBLIC_GATEWAY':
        yield ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY;
        break;
      case 'CONNECTED_TO_COURIER':
        yield ConnectionStatus.CONNECTED_TO_COURIER;
        break;
      case 'DISCONNECTED_FROM_PUBLIC_GATEWAY':
        yield ConnectionStatus.DISCONNECTED_FROM_PUBLIC_GATEWAY;
        break;
      case 'DISCONNECTED':
        yield ConnectionStatus.DISCONNECTED;
        break;
    }
  }
}
