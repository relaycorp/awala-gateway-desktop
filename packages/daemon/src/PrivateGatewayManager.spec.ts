import { GatewayManager } from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { PrivateGatewayManager } from './PrivateGatewayManager';
import { setUpTestDBConnection } from './testUtils/db';

setUpTestDBConnection();

test('Class should be registered as a service', () => {
  const gatewayManager = Container.get(PrivateGatewayManager);

  expect(gatewayManager).toBeInstanceOf(GatewayManager);
});
