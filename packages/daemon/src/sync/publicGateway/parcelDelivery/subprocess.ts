import { Duplex } from 'stream';
import { Container } from 'typedi';

import { GatewayRegistrar } from '../GatewayRegistrar';
import { makeGSCClient } from '../gscClient';

export default async function runParcelCollection(_parentStream: Duplex): Promise<number> {
  const gatewayRegistrar = Container.get(GatewayRegistrar);
  const publicGatewayAddress = await gatewayRegistrar.getPublicGateway();
  if (!publicGatewayAddress) {
    return 1;
  }
  await makeGSCClient(publicGatewayAddress.publicAddress);
  return 123;
}
