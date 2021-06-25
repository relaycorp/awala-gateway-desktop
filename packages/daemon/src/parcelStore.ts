import { Parcel } from '@relaycorp/relaynet-core';
import { deserialize, Document, serialize } from 'bson';
import { createHash } from 'crypto';
import pipe from 'it-pipe';
import { join } from 'path';
import { Container, Inject, Service } from 'typedi';

import { FileStore } from './fileStore';
import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import { ParcelCollectorManager } from './sync/publicGateway/parcelCollection/ParcelCollectorManager';

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
   * @param parcel
   * @param direction The direction of the parcel
   */
  public async store(
    parcelSerialized: Buffer,
    parcel: Parcel,
    direction: ParcelDirection,
  ): Promise<string> {
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

  /**
   * Yield keys for parcels bound for the specified endpoints.
   *
   * @param recipientPrivateAddresses
   * @param keepAlive Whether to watch for incoming parcels in real time
   *
   * If `keepAlive` is enabled, the iterable won't end unless it's ended by the consumer.
   *
   */
  public async *streamActiveBoundForEndpoints(
    recipientPrivateAddresses: readonly string[],
    keepAlive: boolean,
  ): AsyncIterable<string> {
    yield* await this.listQueuedParcelsBoundForEndpoints(recipientPrivateAddresses);

    if (keepAlive) {
      // TODO: Find way not to miss newly-collected parcels between listing queued ones and watching
      const parcelCollectorManager = Container.get(ParcelCollectorManager);
      yield* await parcelCollectorManager.watchCollectionsForRecipients(recipientPrivateAddresses);
    }
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

  protected async *listQueuedParcelsBoundForEndpoints(
    recipientPrivateAddresses: readonly string[],
  ): AsyncIterable<string> {
    const endpointBoundPrefix = getAbsoluteParcelKey(ParcelDirection.INTERNET_TO_ENDPOINT);
    for (const recipientPrivateAddress of recipientPrivateAddresses) {
      const keyPrefix = getAbsoluteParcelKey(
        ParcelDirection.INTERNET_TO_ENDPOINT,
        recipientPrivateAddress,
      );
      yield* await pipe(
        this.fileStore.listObjects(keyPrefix),
        this.filterActiveParcels(endpointBoundPrefix, ParcelDirection.INTERNET_TO_ENDPOINT),
      );
    }
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
