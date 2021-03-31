import { sleep } from './_utils';

export enum ConnectionStatus {
  CONNECTED_TO_PUBLIC_GATEWAY,
  CONNECTED_TO_COURIER,
  DISCONNECTED_FROM_PUBLIC_GATEWAY,
  DISCONNECTED_FROM_ALL,
}

export async function* pollConnectionStatus(): AsyncIterable<ConnectionStatus> {
  yield ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY;
  await sleep(3);

  yield ConnectionStatus.CONNECTED_TO_COURIER;
  await sleep(5);

  yield ConnectionStatus.DISCONNECTED_FROM_PUBLIC_GATEWAY;
  await sleep(5);

  yield ConnectionStatus.DISCONNECTED_FROM_ALL;
  await sleep(2);
}
