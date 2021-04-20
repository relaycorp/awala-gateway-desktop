import { Certificate } from '@relaycorp/relaynet-core';

export interface PublicGateway {
  readonly publicAddress: string;
  readonly identityCertificate: Certificate;
}
