// tslint:disable:max-classes-per-file

import { Parcel, RecipientAddressType } from '@relaycorp/relaynet-core';
import { deserialize, Document, serialize } from 'bson';
import bufferToArray from 'buffer-to-arraybuffer';
import { createHash } from 'crypto';
import pipe from 'it-pipe';
import { join } from 'path';
import { Inject, Service } from 'typedi';

import { PrivateGatewayError } from './errors';
import { FileStore } from './fileStore';
import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';

const PARCEL_METADATA_EXTENSION = '.pmeta';

interface ParcelMetadata {
  // DO NOT rename these, unless you're willing to write a migration script.
  readonly expiryDate: number;
}

export enum ParcelDirection {
  ENDPOINT_TO_INTERNET,
  INTERNET_TO_ENDPOINT,
}

@Service()
export class ParcelStore {
  constructor(
    @Inject() protected fileStore: FileStore,
    @Inject() protected privateKeyStore: DBPrivateKeyStore,
  ) {}

  /**
   *
   * @param parcelSerialized
   * @param direction The direction of the parcel
   * @throws MalformedParcelError if the parcel is malformed
   * @throws InvalidParcelError if the parcel is well-formed yet invalid
   */
  public async store(parcelSerialized: Buffer, direction: ParcelDirection): Promise<string> {
    let parcel: Parcel;
    try {
      parcel = await Parcel.deserialize(bufferToArray(parcelSerialized));
    } catch (err) {
      throw new MalformedParcelError(err);
    }

    const recipientAddressType =
      direction === ParcelDirection.INTERNET_TO_ENDPOINT ? RecipientAddressType.PRIVATE : undefined;
    const trustedCertificates =
      direction === ParcelDirection.INTERNET_TO_ENDPOINT
        ? await this.privateKeyStore.fetchNodeCertificates()
        : undefined;
    try {
      await parcel.validate(recipientAddressType, trustedCertificates);
    } catch (err) {
      throw new InvalidParcelError(err);
    }
    const parcelRelativeKey = await getRelativeParcelKey(parcel, direction);
    const parcelAbsoluteKey = getAbsoluteParcelKey(direction, parcelRelativeKey);
    await this.fileStore.putObject(parcelSerialized, parcelAbsoluteKey);

    const parcelMetadata: ParcelMetadata = { expiryDate: parcel.expiryDate.getTime() / 1_000 };
    await this.fileStore.putObject(
      serialize(parcelMetadata),
      parcelAbsoluteKey + PARCEL_METADATA_EXTENSION,
    );

    return parcelRelativeKey;
  }

  public async *listActiveBoundForInternet(): AsyncIterable<string> {
    const keyPrefix = getAbsoluteParcelKey(ParcelDirection.ENDPOINT_TO_INTERNET);
    const absoluteKeys = await this.fileStore.listObjects(keyPrefix);
    yield* await pipe(
      absoluteKeys,
      this.filterActiveParcels(keyPrefix, ParcelDirection.ENDPOINT_TO_INTERNET),
    );
  }

  public async *listActiveBoundForEndpoints(
    recipientPrivateAddresses: readonly string[],
  ): AsyncIterable<string> {
    const keyPrefixes = recipientPrivateAddresses.map((a) =>
      getAbsoluteParcelKey(ParcelDirection.INTERNET_TO_ENDPOINT, a),
    );
    const endpointBoundPrefix = getAbsoluteParcelKey(ParcelDirection.INTERNET_TO_ENDPOINT);
    const listings = keyPrefixes.map((prefix) =>
      pipe(
        this.fileStore.listObjects(prefix),
        this.filterActiveParcels(endpointBoundPrefix, ParcelDirection.INTERNET_TO_ENDPOINT),
      ),
    );
    yield* await concatIterables(listings);
  }

  public async retrieve(
    parcelRelativeKey: string,
    direction: ParcelDirection,
  ): Promise<Buffer | null> {
    const absoluteKey = getAbsoluteParcelKey(direction, parcelRelativeKey);
    return this.fileStore.getObject(absoluteKey);
  }

  public async delete(parcelRelativeKey: string, direction: ParcelDirection): Promise<void> {
    const absoluteKey = getAbsoluteParcelKey(direction, parcelRelativeKey);
    await this.fileStore.deleteObject(absoluteKey);
    await this.fileStore.deleteObject(absoluteKey + PARCEL_METADATA_EXTENSION);
  }

  protected filterActiveParcels(
    keyPrefix: string,
    direction: ParcelDirection,
  ): (parcelKeys: AsyncIterable<string>) => AsyncIterable<string> {
    // tslint:disable-next-line:no-this-assignment
    const store = this;
    return async function* (parcelKeys): AsyncIterable<any> {
      for await (const absoluteKey of parcelKeys) {
        if (absoluteKey.endsWith(PARCEL_METADATA_EXTENSION)) {
          continue;
        }
        const relativeKey = absoluteKey.substr(keyPrefix.length + 1);

        const expiryDate = await store.getParcelExpiryDate(absoluteKey);
        if (!expiryDate || expiryDate < new Date()) {
          await store.delete(relativeKey, direction);
          continue;
        }

        yield relativeKey;
      }
    };
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

async function getRelativeParcelKey(parcel: Parcel, direction: ParcelDirection): Promise<string> {
  const senderPrivateAddress = await parcel.senderCertificate.calculateSubjectPrivateAddress();
  // Hash some components together to avoid exceeding Windows' 260-char limit for paths
  const keyComponents =
    direction === ParcelDirection.ENDPOINT_TO_INTERNET
      ? [senderPrivateAddress, await sha256Hex(parcel.recipientAddress + parcel.id)]
      : [parcel.recipientAddress, await sha256Hex(senderPrivateAddress + parcel.id)];
  return join(...keyComponents);
}

function getAbsoluteParcelKey(direction: ParcelDirection, parcelRelativeKey?: string): string {
  const subComponent =
    direction === ParcelDirection.ENDPOINT_TO_INTERNET ? 'internet-bound' : 'endpoint-bound';
  const trailingComponents = parcelRelativeKey ? [parcelRelativeKey] : [];
  return join('parcels', subComponent, ...trailingComponents);
}

async function* concatIterables<T>(iterables: ReadonlyArray<AsyncIterable<T>>): AsyncIterable<T> {
  for (const iterable of iterables) {
    yield* await iterable;
  }
}
