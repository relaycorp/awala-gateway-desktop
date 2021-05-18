// tslint:disable:max-classes-per-file

import { Parcel } from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { createHash } from 'crypto';
import { Inject, Service } from 'typedi';

import { PrivateGatewayError } from './errors';
import { FileStore } from './fileStore';

@Service()
export class ParcelStore {
  constructor(@Inject() protected fileStore: FileStore) {}

  /**
   *
   * @param parcelSerialized
   * @throws MalformedParcelError if the parcel is malformed
   * @throws InvalidParcelError if the parcel is well-formed yet invalid
   */
  public async storeInternetBoundParcel(parcelSerialized: Buffer): Promise<void> {
    let parcel: Parcel;
    try {
      parcel = await Parcel.deserialize(bufferToArray(parcelSerialized));
    } catch (err) {
      throw new MalformedParcelError(err);
    }
    try {
      await parcel.validate();
    } catch (err) {
      throw new InvalidParcelError(err);
    }

    const parcelKey = [
      'parcels',
      'internet-bound',
      await parcel.senderCertificate.calculateSubjectPrivateAddress(),
      // Hash the recipient and id together to avoid exceeding Windows' 260-char limit for paths
      await sha256Hex(parcel.recipientAddress + parcel.id),
    ].join('/');
    await this.fileStore.putObject(parcelSerialized, parcelKey);
  }
}

export class MalformedParcelError extends PrivateGatewayError {}

export class InvalidParcelError extends PrivateGatewayError {}

export function sha256Hex(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
