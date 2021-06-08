import { Container } from 'typedi';

import { GatewayRegistrar } from './publicGateway/GatewayRegistrar';
import { ParcelDeliveryManager } from './publicGateway/parcelDelivery/ParcelDeliveryManager';
import { StatusMonitor } from './StatusMonitor';

export default async function runSync(): Promise<void> {
  const statusMonitor = Container.get(StatusMonitor);
  const gatewayRegistrar = Container.get(GatewayRegistrar);
  const parcelDeliveryManager = Container.get(ParcelDeliveryManager);

  await Promise.all([
    statusMonitor.start(),
    parcelDeliveryManager.deliverWhileConnected(),
    gatewayRegistrar.registerIfUnregistered(),
  ]);
}
