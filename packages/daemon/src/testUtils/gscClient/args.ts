import { Signer, StreamingMode } from '@relaycorp/relaynet-core';

export interface CallArgs {}

export interface PreRegisterNodeArgs extends CallArgs {
  readonly nodePublicKey: CryptoKey;
}

export interface RegisterNodeArgs extends CallArgs {
  readonly pnrrSerialized: ArrayBuffer;
}

export interface DeliverParcelArgs extends CallArgs {
  readonly parcelSerialized: ArrayBuffer;
  readonly deliverySigner: Signer;
}

export interface CollectParcelsArgs extends CallArgs {
  readonly nonceSigners: readonly Signer[];
  readonly streamingMode: StreamingMode;
}
