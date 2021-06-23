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
  const gatewayRegistrar = Container.get(GatewayRegistrar);
  await gatewayRegistrar.waitForRegistration();

  const parcelDeliveryManager = Container.get(ParcelDeliveryManager);
  const parcelCollectorManager = Container.get(ParcelCollectorManager);
  parcelCollectorManager.start();
  await parcelDeliveryManager.deliverWhileConnected();
}
