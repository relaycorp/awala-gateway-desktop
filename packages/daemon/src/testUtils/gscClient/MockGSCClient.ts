import {
  GSCClient,
  ParcelCollection,
  PrivateNodeRegistration,
  Signer,
  StreamingMode,
} from '@relaycorp/relaynet-core';

import {
  CollectParcelsArgs,
  DeliverParcelArgs,
  PreRegisterNodeArgs,
  RegisterNodeArgs,
} from './args';
import {
  CollectParcelsCall,
  DeliverParcelCall,
  MockMethodCall,
  PreRegisterNodeCall,
  RegisterNodeCall,
} from './methodCalls';

export class MockGSCClient implements GSCClient {
  // tslint:disable-next-line:readonly-array
  constructor(private callQueue: Array<MockMethodCall<any, any>>) {}

  public get callsRemaining(): number {
    return this.callQueue.length;
  }

  public collectParcels(
    nonceSigners: readonly Signer[],
    streamingMode: StreamingMode,
  ): AsyncIterable<ParcelCollection> {
    const call = this.getNextCall(CollectParcelsCall);
    const args: CollectParcelsArgs = { nonceSigners, streamingMode };
    return call.call(args);
  }

  public async deliverParcel(parcelSerialized: ArrayBuffer, signer: Signer): Promise<void> {
    const call = this.getNextCall(DeliverParcelCall);
    const args: DeliverParcelArgs = { parcelSerialized, deliverySigner: signer };
    return call.call(args);
  }

  public async preRegisterNode(nodePublicKey: CryptoKey): Promise<ArrayBuffer> {
    const call = this.getNextCall(PreRegisterNodeCall);
    const args: PreRegisterNodeArgs = { nodePublicKey };
    return call.call(args);
  }

  public async registerNode(pnrrSerialized: ArrayBuffer): Promise<PrivateNodeRegistration> {
    const call = this.getNextCall(RegisterNodeCall);
    const args: RegisterNodeArgs = { pnrrSerialized };
    return call.call(args);
  }

  protected getNextCall<Call extends MockMethodCall<any, any>>(
    callClass: new (...args: any) => Call,
  ): Call {
    const call = this.callQueue.shift();
    if (!call) {
      throw new Error('Call queue is empty');
    }
    if (!(call instanceof callClass)) {
      throw new Error(`Next call in queue is not of type ${callClass.name}`);
    }
    return call;
  }
}
