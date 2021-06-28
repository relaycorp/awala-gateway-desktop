export const COURIER_PORT = 21473;

export enum CourierSyncStage {
  COLLECTION = 'COLLECTION',
  WAIT = 'WAIT',
  DELIVERY = 'DELIVERY',
}

export enum CourierConnectionStatus {
  DISCONNECTED,
  CONNECTED,
}

export enum CourierSyncExitCode {
  OK = 0,
  UNREGISTERED_GATEWAY = 1,
  FAILED_SYNC = 2,
}
