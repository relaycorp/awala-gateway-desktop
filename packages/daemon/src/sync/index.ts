import { Container } from 'typedi';

import { GatewayRegistrar } from './publicGateway/GatewayRegistrar';
import { ParcelCollectorManager } from './publicGateway/parcelCollection/ParcelCollectorManager';
import { ParcelDeliveryManager } from './publicGateway/parcelDelivery/ParcelDeliveryManager';
import { StatusMonitor } from './StatusMonitor';

export default async function runSync(): Promise<void> {
  const statusMonitor = Container.get(StatusMonitor);

  await Promise.all([statusMonitor.start(), startSubprocesses()]);
}

async function startSubprocesses(): Promise<void> {
  await Container.get(GatewayRegistrar).waitForRegistration();

  await Container.get(ParcelCollectorManager).start();
  await Container.get(ParcelDeliveryManager).deliverWhileConnected();
}
