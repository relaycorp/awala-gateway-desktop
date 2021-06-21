import { Certificate, Parcel } from '@relaycorp/relaynet-core';
import { NodeKeyPairSet, PDACertPath } from '@relaycorp/relaynet-testing';

import { ParcelDirection } from '../parcelStore';

export interface GeneratedParcel {
  readonly parcel: Parcel;
  readonly parcelSerialized: Buffer;
}

export async function makeParcel(
  direction: ParcelDirection,
  certPath: PDACertPath,
  keyPairSet: NodeKeyPairSet,
): Promise<GeneratedParcel> {
  let recipientAddress: string;
  let senderCertificate: Certificate;
  let senderPrivateKey: CryptoKey;
  if (direction === ParcelDirection.ENDPOINT_TO_INTERNET) {
    recipientAddress = 'https://example.com';
    senderCertificate = certPath.privateEndpoint;
    senderPrivateKey = keyPairSet.privateEndpoint.privateKey;
  } else {
    recipientAddress = await certPath.privateEndpoint.calculateSubjectPrivateAddress();
    senderCertificate = certPath.pdaGrantee;
    senderPrivateKey = keyPairSet.pdaGrantee.privateKey;
  }
  const parcel = new Parcel(recipientAddress, senderCertificate, Buffer.from([]));
  const parcelSerialized = Buffer.from(await parcel.serialize(senderPrivateKey));
  return { parcel, parcelSerialized };
}
