import { Certificate, Parcel, Recipient } from '@relaycorp/relaynet-core';
import { NodeKeyPairSet, PDACertPath } from '@relaycorp/relaynet-testing';

import { MessageDirection } from '../utils/MessageDirection';

export interface GeneratedParcel {
  readonly parcel: Parcel;
  readonly parcelSerialized: Buffer;
}

export async function makeParcel(
  direction: MessageDirection,
  certPath: PDACertPath,
  keyPairSet: NodeKeyPairSet,
): Promise<GeneratedParcel> {
  let recipient: Recipient;
  let senderCertificate: Certificate;
  let senderPrivateKey: CryptoKey;
  let senderCaCertificateChain: readonly Certificate[];
  const recipientId = await certPath.privateEndpoint.calculateSubjectId();
  if (direction === MessageDirection.TOWARDS_INTERNET) {
    recipient = { id: recipientId, internetAddress: 'example.com' };
    senderCertificate = certPath.privateEndpoint;
    senderPrivateKey = keyPairSet.privateEndpoint.privateKey!;
    senderCaCertificateChain = [];
  } else {
    recipient = { id: recipientId };
    senderCertificate = certPath.pdaGrantee;
    senderPrivateKey = keyPairSet.pdaGrantee.privateKey!;
    senderCaCertificateChain = [certPath.privateGateway, certPath.privateEndpoint];
  }
  const parcel = new Parcel(recipient, senderCertificate, Buffer.from([]), {
    senderCaCertificateChain,
  });
  const parcelSerialized = Buffer.from(await parcel.serialize(senderPrivateKey));
  return { parcel, parcelSerialized };
}
