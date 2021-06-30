import { Cargo, Certificate, Parcel } from '@relaycorp/relaynet-core';
import { CDACertPath, NodeKeyPairSet, PDACertPath } from '@relaycorp/relaynet-testing';

import { MessageDirection } from '../utils/MessageDirection';

export interface GeneratedParcel {
  readonly parcel: Parcel;
  readonly parcelSerialized: Buffer;
}

export interface GeneratedCargo {
  readonly cargo: Cargo;
  readonly cargoSerialized: Buffer;
}

export async function makeParcel(
  direction: MessageDirection,
  certPath: PDACertPath,
  keyPairSet: NodeKeyPairSet,
): Promise<GeneratedParcel> {
  let recipientAddress: string;
  let senderCertificate: Certificate;
  let senderPrivateKey: CryptoKey;
  let senderCaCertificateChain: readonly Certificate[];
  if (direction === MessageDirection.TOWARDS_INTERNET) {
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

export async function makeCargo(
  cdaCertPath: CDACertPath,
  keyPairSet: NodeKeyPairSet,
  payloadSerialized: Buffer,
): Promise<GeneratedCargo> {
  const cargo = new Cargo(
    await cdaCertPath.privateGateway.calculateSubjectPrivateAddress(),
    cdaCertPath.publicGateway,
    payloadSerialized,
  );
  const cargoSerialized = Buffer.from(await cargo.serialize(keyPairSet.publicGateway.privateKey));
  return { cargo, cargoSerialized };
}
