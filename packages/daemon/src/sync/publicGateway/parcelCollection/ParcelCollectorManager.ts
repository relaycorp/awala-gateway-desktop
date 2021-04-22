import { v4 as getDefaultGateway } from 'default-gateway';
import { Service } from 'typedi';

import { PublicGatewayCollectionStatus } from '../PublicGatewayCollectionStatus';

@Service()
export class ParcelCollectorManager {
  // public async *start(): AsyncIterable<ParcelCollection> {
  //   throw new Error('Implement!');
  // }
  //
  // public restart(): void {
  //   throw new Error('Implement!');
  // }

  public async *streamStatus(): AsyncIterable<PublicGatewayCollectionStatus> {
    while (true) {
      try {
        await getDefaultGateway();
        yield PublicGatewayCollectionStatus.CONNECTED;
      } catch (_) {
        yield PublicGatewayCollectionStatus.DISCONNECTED;
      }
    }
  }
}
