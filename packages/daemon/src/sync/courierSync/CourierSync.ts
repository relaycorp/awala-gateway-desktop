import { v4 as getDefaultGateway } from 'default-gateway';
import { waitUntilUsedOnHost } from 'tcp-port-used';
import { Service } from 'typedi';

export const COURIER_PORT = 21473;
const COURIER_CHECK_TIMEOUT_MS = 3_000;
const COURIER_CHECK_RETRY_MS = 500;

export enum CourierConnectionStatus {
  DISCONNECTED,
  CONNECTED,
}

// export enum CourierSyncStage {
//   COLLECTING_CARGO,
//   WAITING,
//   DELIVERING_CARGO,
// }

@Service()
export class CourierSync {
  public async *streamStatus(): AsyncIterable<CourierConnectionStatus> {
    let lastStatus: CourierConnectionStatus | null = null;
    while (true) {
      const newStatus = await this.getCourierConnectionStatus();
      if (newStatus !== lastStatus) {
        lastStatus = newStatus;
        yield newStatus;
      }
    }
  }

  // public async *sync(): AsyncIterable<CourierSyncStage> {
  //   throw new Error('implement!');
  // }

  protected async getDefaultGatewayIPAddress(): Promise<string> {
    const { gateway: gatewayIPAddress } = await getDefaultGateway();
    return gatewayIPAddress;
  }

  protected async getCourierConnectionStatus(): Promise<CourierConnectionStatus> {
    const gatewayIPAddress = await this.getDefaultGatewayIPAddress();
    try {
      await waitUntilUsedOnHost(
        COURIER_PORT,
        gatewayIPAddress,
        COURIER_CHECK_RETRY_MS,
        COURIER_CHECK_TIMEOUT_MS,
      );
    } catch (_) {
      return CourierConnectionStatus.DISCONNECTED;
    }
    return CourierConnectionStatus.CONNECTED;
  }
}
