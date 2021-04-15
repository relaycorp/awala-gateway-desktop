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

export enum CourierSyncStage {
  COLLECTION = 'COLLECTION',
  WAIT = 'WAIT',
  DELIVERY = 'DELIVERY',
}

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

  public async *sync(): AsyncIterable<CourierSyncStage> {
    throw new Error('implement!');
  }

  /**
   * Get the system's default gateway IPv4 address, if connected to a network.
   */
  protected async getDefaultGatewayIPAddress(): Promise<string | null> {
    try {
      const { gateway: gatewayIPAddress } = await getDefaultGateway();
      return gatewayIPAddress;
    } catch (_) {
      return null;
    }
  }

  protected async getCourierConnectionStatus(): Promise<CourierConnectionStatus> {
    const gatewayIPAddress = await this.getDefaultGatewayIPAddress();
    if (!gatewayIPAddress) {
      return CourierConnectionStatus.DISCONNECTED;
    }
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
