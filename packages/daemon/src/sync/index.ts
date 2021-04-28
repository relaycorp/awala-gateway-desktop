import { Container } from 'typedi';

import { GatewayRegistrar } from './publicGateway/GatewayRegistrar';
import { StatusMonitor } from './StatusMonitor';

export default async function runSync(): Promise<void> {
  const statusMonitor = Container.get(StatusMonitor);
  const gatewayRegistrar = Container.get(GatewayRegistrar);

  await Promise.all([statusMonitor.start(), gatewayRegistrar.registerIfUnregistered()]);
}
