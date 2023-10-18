import pipe from 'it-pipe';
import { Duplex } from 'stream';
import { Inject, Service } from 'typedi';

import { fork } from '../../../utils/subprocess/child';
import { ParcelCollectorManager } from '../parcelCollection/ParcelCollectorManager';
import { InternetGatewayCollectionStatus } from '../InternetGatewayCollectionStatus';

@Service()
export class ParcelDeliveryManager {
  // tslint:disable-next-line:readonly-keyword
  protected subprocess: Duplex | null = null;

  constructor(@Inject() private parcelCollectorManager: ParcelCollectorManager) {}

  public async deliverWhileConnected(): Promise<void> {
    await pipe(this.parcelCollectorManager.streamStatus(), async (statuses) => {
      for await (const status of statuses) {
        if (status === InternetGatewayCollectionStatus.DISCONNECTED) {
          this.subprocess?.destroy();
          // tslint:disable-next-line:no-object-mutation
          this.subprocess = null;
        } else if (!this.subprocess) {
          // tslint:disable-next-line:no-object-mutation
          this.subprocess = await fork('parcel-delivery');
        }
      }
    });
  }

  public notifyAboutNewParcel(parcelKey: string): void {
    this.subprocess?.write(parcelKey);
  }
}
