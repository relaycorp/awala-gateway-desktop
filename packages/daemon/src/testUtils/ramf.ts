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
  let senderCaCertificateChain: readonly Certificate[];
  if (direction === ParcelDirection.ENDPOINT_TO_INTERNET) {
    recipientAddress = 'https://example.com';
    senderCertificate = certPath.privateEndpoint;
    senderPrivateKey = keyPairSet.privateEndpoint.privateKey;
    senderCaCertificateChain = [];
  } else {
    recipientAddress = await certPath.privateEndpoint.calculateSubjectPrivateAddress();
    senderCertificate = certPath.pdaGrantee;
    senderPrivateKey = keyPairSet.pdaGrantee.privateKey;
    senderCaCertificateChain = [certPath.privateGateway, certPath.privateEndpoint];
  }
  const parcel = new Parcel(recipientAddress, senderCertificate, Buffer.from([]), {
    senderCaCertificateChain,
  });
  const parcelSerialized = Buffer.from(await parcel.serialize(senderPrivateKey));
  return { parcel, parcelSerialized };
}
