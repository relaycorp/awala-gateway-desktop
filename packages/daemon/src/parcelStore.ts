// tslint:disable:max-classes-per-file

import { Parcel } from '@relaycorp/relaynet-core';
import { deserialize, Document, serialize } from 'bson';
import bufferToArray from 'buffer-to-arraybuffer';
import { createHash } from 'crypto';
import { Inject, Service } from 'typedi';

import { PrivateGatewayError } from './errors';
import { FileStore } from './fileStore';

const PARCEL_METADATA_EXTENSION = '.pmeta';

interface ParcelMetadata {
  // DO NOT rename these, unless you're willing to write a migration script.
  readonly expiryDate: number;
}

@Service()
export class ParcelStore {
  constructor(@Inject() protected fileStore: FileStore) {}

  /**
   *
   * @param parcelSerialized
   * @throws MalformedParcelError if the parcel is malformed
   * @throws InvalidParcelError if the parcel is well-formed yet invalid
   */
  public async storeInternetBoundParcel(parcelSerialized: Buffer): Promise<string> {
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

    const parcelRelativeKey = [
      await parcel.senderCertificate.calculateSubjectPrivateAddress(),
      // Hash the recipient and id together to avoid exceeding Windows' 260-char limit for paths
      await sha256Hex(parcel.recipientAddress + parcel.id),
    ].join('/');
    const parcelAbsoluteKey = getInternetBoundParcelKey(parcelRelativeKey);
    await this.fileStore.putObject(parcelSerialized, parcelAbsoluteKey);

    const parcelMetadata: ParcelMetadata = { expiryDate: parcel.expiryDate.getTime() / 1_000 };
    await this.fileStore.putObject(
      serialize(parcelMetadata),
      parcelAbsoluteKey + PARCEL_METADATA_EXTENSION,
    );

    return parcelRelativeKey;
  }

  public async *listActiveInternetBoundParcels(): AsyncIterable<string> {
    const keyPrefix = getInternetBoundParcelKey();
    const objectKeys = await this.fileStore.listObjects(keyPrefix);
    for await (const objectKey of objectKeys) {
      if (objectKey.endsWith(PARCEL_METADATA_EXTENSION)) {
        continue;
      }
      const parcelRelativeKey = objectKey.substr(keyPrefix.length + 1);

      const expiryDate = await this.getParcelExpiryDate(objectKey);
      if (!expiryDate || expiryDate < new Date()) {
        await this.deleteInternetBoundParcel(parcelRelativeKey);
        continue;
      }

      yield parcelRelativeKey;
    }
  }

  public async retrieveInternetBoundParcel(key: string): Promise<Buffer | null> {
    const absoluteKey = getInternetBoundParcelKey(key);
    return this.fileStore.getObject(absoluteKey);
  }

  public async deleteInternetBoundParcel(key: string): Promise<void> {
    const absoluteKey = getInternetBoundParcelKey(key);
    await this.fileStore.deleteObject(absoluteKey);
    await this.fileStore.deleteObject(absoluteKey + PARCEL_METADATA_EXTENSION);
  }

  protected async getParcelExpiryDate(parcelKey: string): Promise<Date | null> {
    const parcelMetadataKey = parcelKey + PARCEL_METADATA_EXTENSION;
    const metadataFile = await this.fileStore.getObject(parcelMetadataKey);
    if (!metadataFile) {
      return null;
    }
    let document: Document;
    try {
      document = deserialize(metadataFile);
    } catch (err) {
      return null;
    }
    if (!Number.isFinite(document.expiryDate)) {
      return null;
    }
    const expiryTimestamp = document.expiryDate * 1_000;
    return new Date(expiryTimestamp);
  }
}

export class MalformedParcelError extends PrivateGatewayError {}

export class InvalidParcelError extends PrivateGatewayError {}

function sha256Hex(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function getInternetBoundParcelKey(parcelRelativeKey?: string): string {
  return ['parcels', 'internet-bound', ...(parcelRelativeKey ? [parcelRelativeKey] : [])].join('/');
}
