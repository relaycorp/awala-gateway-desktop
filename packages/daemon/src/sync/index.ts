import { consume } from 'streaming-iterables';
import { Container } from 'typedi';

import { GatewayRegistrar } from './internetGateway/GatewayRegistrar';
import { ParcelCollectorManager } from './internetGateway/parcelCollection/ParcelCollectorManager';
import { ParcelDeliveryManager } from './internetGateway/parcelDelivery/ParcelDeliveryManager';
import { StatusMonitor } from './StatusMonitor';
import { DBCertificateStore } from '../keystores/DBCertificateStore';

export default async function runSync(): Promise<void> {
  const statusMonitor = Container.get(StatusMonitor);

  await Promise.all([statusMonitor.start(), sync()]);
}

async function sync(): Promise<void> {
  const certificateStore = Container.get(DBCertificateStore);
  await certificateStore.deleteExpired();

  const gatewayRegistrar = Container.get(GatewayRegistrar);
  await gatewayRegistrar.waitForRegistration();
  await Promise.all([
    startSubprocesses(),
    consume(gatewayRegistrar.continuallyRenewRegistration()),
  ]);
}

async function startSubprocesses(): Promise<void> {
  await Container.get(ParcelCollectorManager).start();
  await Container.get(ParcelDeliveryManager).deliverWhileConnected();
}
