import { GatewayManager } from '@relaycorp/relaynet-core';
import { Inject, Service } from 'typedi';

import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import { DBPublicKeyStore } from './keystores/DBPublicKeyStore';

@Service()
export class PrivateGatewayManager extends GatewayManager {
  constructor(
    @Inject() protected privateKeyStore: DBPrivateKeyStore,
    @Inject() protected publicKeyStore: DBPublicKeyStore,
  ) {
    super(privateKeyStore, publicKeyStore);
  }
}
