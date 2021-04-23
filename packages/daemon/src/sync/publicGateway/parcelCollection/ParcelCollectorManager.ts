import isOnline from 'is-online';
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
      const onlineIsIt = await isOnline();
      yield onlineIsIt
        ? PublicGatewayCollectionStatus.CONNECTED
        : PublicGatewayCollectionStatus.DISCONNECTED;
    }
  }
}
