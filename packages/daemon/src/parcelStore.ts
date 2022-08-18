import { Parcel, ParcelCollectionAck } from '@relaycorp/relaynet-core';
import { deserialize, Document, serialize } from 'bson';
import { createHash } from 'crypto';
import pipe from 'it-pipe';
import { join } from 'path';
import { Logger } from 'pino';
import { parallelMerge } from 'streaming-iterables';
import { Container, Inject, Service } from 'typedi';
import { InjectRepository } from 'typeorm-typedi-extensions';
import { Repository } from 'typeorm';

import { ParcelCollection } from './entity/ParcelCollection';
import { FileStore } from './fileStore';
import { DBPrivateKeyStore } from './keystores/DBPrivateKeyStore';
import { CourierSyncManager } from './sync/courierSync/CourierSyncManager';
import { ParcelCollectorManager } from './sync/publicGateway/parcelCollection/ParcelCollectorManager';
import { LOGGER } from './tokens';
import { MessageDirection } from './utils/MessageDirection';

const PARCEL_METADATA_EXTENSION = '.pmeta';

interface ParcelMetadata {
  // DO NOT rename these, unless you're willing to write a migration script.
  readonly expiryDate: number;
}

export interface ParcelWithExpiryDate {
  readonly parcelKey: string;
  readonly expiryDate: Date;
}

@Service()
export class ParcelStore {
  public static readonly FILE_STORE_PREFIX = 'parcels';

  constructor(
    @Inject() protected fileStore: FileStore,
    @Inject() protected privateKeyStore: DBPrivateKeyStore,
    @InjectRepository(ParcelCollection) protected collectionRepo: Repository<ParcelCollection>,
    @Inject(LOGGER) protected logger: Logger,
  ) {}

  /**
   * Store the specified parcel.
   *
   * @param parcelSerialized
   * @param parcel
   */
  public async storeEndpointBound(
    parcelSerialized: Buffer,
    parcel: Parcel,
  ): Promise<string | null> {
    let isParcelNew = true;
    if (await wasEndpointBoundParcelCollected(parcel, this.collectionRepo)) {
      isParcelNew = false;
      if (await this.wasEndpointBoundParcelDelivered(parcel)) {
        return null;
      }
    }
    const parcelKey = await this.store(parcelSerialized, parcel, MessageDirection.FROM_INTERNET);
    return isParcelNew ? parcelKey : null;
  }

  /**
   * Yield keys for parcels bound for the specified endpoints.
   *
   * @param recipientIds
   * @param keepAlive Whether to watch for incoming parcels in real time
   *
   * If `keepAlive` is enabled, the iterable won't end unless it's ended by the consumer.
   *
   */
  public async *streamEndpointBound(
    recipientIds: readonly string[],
    keepAlive: boolean,
  ): AsyncIterable<string> {
    const uniqueRecipientIds = Array.from(new Set(recipientIds));

    yield* await this.listQueuedParcelsBoundForEndpoints(uniqueRecipientIds);

    if (keepAlive) {
      // TODO: Find way not to miss newly-collected parcels between listing queued ones and watching
      const parcelCollectorManager = Container.get(ParcelCollectorManager);
      const courierSyncManager = Container.get(CourierSyncManager);
      yield* await parallelMerge(
        parcelCollectorManager.watchCollectionsForRecipients(uniqueRecipientIds),
        courierSyncManager.streamCollectedParcelKeys(uniqueRecipientIds),
      );
    }
  }

  public async storeInternetBound(parcelSerialized: Buffer, parcel: Parcel): Promise<string> {
    return this.store(parcelSerialized, parcel, MessageDirection.TOWARDS_INTERNET);
  }

  public async *listInternetBound(): AsyncIterable<ParcelWithExpiryDate> {
    const keyPrefix = getAbsoluteParcelKey(MessageDirection.TOWARDS_INTERNET);
    const absoluteKeys = await this.fileStore.listObjects(keyPrefix);
    yield* await pipe(
      absoluteKeys,
      this.filterActiveParcels(keyPrefix, MessageDirection.TOWARDS_INTERNET),
    );
  }

  public async retrieve(
    parcelRelativeKey: string,
    direction: MessageDirection,
  ): Promise<Buffer | null> {
    const absoluteKey = getAbsoluteParcelKey(direction, parcelRelativeKey);
    return this.fileStore.getObject(absoluteKey);
  }

  public async delete(parcelRelativeKey: string, direction: MessageDirection): Promise<void> {
    const absoluteKey = getAbsoluteParcelKey(direction, parcelRelativeKey);
    await this.fileStore.deleteObject(absoluteKey);
    await this.fileStore.deleteObject(absoluteKey + PARCEL_METADATA_EXTENSION);
  }

  public async deleteInternetBoundFromACK(ack: ParcelCollectionAck): Promise<void> {
    const isAckValid = isAlphaNumeric(ack.senderEndpointId) && isAlphaNumeric(ack.parcelId);
    if (!isAckValid) {
      return;
    }
    const relativeKey = await getRelativeParcelKeyFromParts(
      ack.senderEndpointId,
      ack.recipientEndpointId,
      ack.parcelId,
      MessageDirection.TOWARDS_INTERNET,
    );
    await this.delete(relativeKey, MessageDirection.TOWARDS_INTERNET);
  }

  protected async store(
    parcelSerialized: Buffer,
    parcel: Parcel,
    direction: MessageDirection,
  ): Promise<string> {
    const parcelRelativeKey = await getRelativeParcelKey(parcel, direction);
    const parcelAbsoluteKey = getAbsoluteParcelKey(direction, parcelRelativeKey);

    // Store the metadata first to avoid a race condition with methods that watch the filesystem
    // for new parcels
    const parcelMetadata: ParcelMetadata = { expiryDate: parcel.expiryDate.getTime() / 1_000 };
    await this.fileStore.putObject(
      serialize(parcelMetadata),
      parcelAbsoluteKey + PARCEL_METADATA_EXTENSION,
    );

    await this.fileStore.putObject(parcelSerialized, parcelAbsoluteKey);

    return parcelRelativeKey;
  }

  protected filterActiveParcels(
    keyPrefix: string,
    direction: MessageDirection,
  ): (parcelKeys: AsyncIterable<string>) => AsyncIterable<ParcelWithExpiryDate> {
    // tslint:disable-next-line:no-this-assignment
    const store = this;
    return async function* (parcelKeys): AsyncIterable<ParcelWithExpiryDate> {
      for await (const absoluteKey of parcelKeys) {
        if (absoluteKey.endsWith(PARCEL_METADATA_EXTENSION)) {
          continue;
        }
        const relativeKey = absoluteKey.substr(keyPrefix.length + 1);

        const expiryDate = await store.getParcelExpiryDate(absoluteKey, relativeKey);
        const now = new Date();
        if (!expiryDate || expiryDate < now) {
          await store.delete(relativeKey, direction);
          continue;
        }

        yield { parcelKey: relativeKey, expiryDate };
      }
    };
  }

  protected async *listQueuedParcelsBoundForEndpoints(
    recipientPrivateAddresses: readonly string[],
  ): AsyncIterable<string> {
    const endpointBoundPrefix = getAbsoluteParcelKey(MessageDirection.FROM_INTERNET);
    for (const recipientPrivateAddress of recipientPrivateAddresses) {
      const keyPrefix = getAbsoluteParcelKey(
        MessageDirection.FROM_INTERNET,
        recipientPrivateAddress,
      );
      yield* await pipe(
        this.fileStore.listObjects(keyPrefix),
        this.filterActiveParcels(endpointBoundPrefix, MessageDirection.FROM_INTERNET),
        async function* (parcels: AsyncIterable<ParcelWithExpiryDate>): AsyncIterable<string> {
          for await (const parcel of parcels) {
            yield parcel.parcelKey;
          }
        },
      );
    }
  }

  protected async getParcelExpiryDate(
    absoluteKey: string,
    relativeKey: string,
  ): Promise<Date | null> {
    const parcelAwareLogger = this.logger.child({ parcelKey: relativeKey });

    const parcelMetadataKey = absoluteKey + PARCEL_METADATA_EXTENSION;
    const metadataFile = await this.fileStore.getObject(parcelMetadataKey);
    if (!metadataFile) {
      parcelAwareLogger.warn('Failed to find parcel metadata file');
      return null;
    }
    let document: Document;
    try {
      document = deserialize(metadataFile);
    } catch (err) {
      parcelAwareLogger.warn({ err }, 'Malformed parcel metadata file');
      return null;
    }
    if (!Number.isFinite(document.expiryDate)) {
      parcelAwareLogger.warn(
        { expiryDate: document.expiryDate },
        'Parcel metadata does not have a (valid) expiry date',
      );
      return null;
    }
    const expiryTimestamp = document.expiryDate * 1_000;
    return new Date(expiryTimestamp);
  }

  protected async wasEndpointBoundParcelDelivered(parcel: Parcel): Promise<boolean> {
    const parcelRelativeKey = await getRelativeParcelKey(parcel, MessageDirection.FROM_INTERNET);
    const parcelAbsoluteKey = getAbsoluteParcelKey(
      MessageDirection.FROM_INTERNET,
      parcelRelativeKey,
    );
    return !(await this.fileStore.objectExists(parcelAbsoluteKey));
  }
}

function sha256Hex(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

async function getRelativeParcelKey(parcel: Parcel, direction: MessageDirection): Promise<string> {
  const senderPrivateAddress = await parcel.senderCertificate.calculateSubjectId();
  return getRelativeParcelKeyFromParts(
    senderPrivateAddress,
    parcel.recipient.id,
    parcel.id,
    direction,
  );
}

async function getRelativeParcelKeyFromParts(
  senderPrivateAddress: string,
  recipientAddress: string,
  parcelId: string,
  direction: MessageDirection,
): Promise<string> {
  // Hash some components together to avoid exceeding Windows' 260-char limit for paths
  const keyComponents =
    direction === MessageDirection.TOWARDS_INTERNET
      ? [senderPrivateAddress, sha256Hex(recipientAddress + parcelId)]
      : [recipientAddress, sha256Hex(senderPrivateAddress + parcelId)];
  return join(...keyComponents);
}

function getAbsoluteParcelKey(direction: MessageDirection, parcelRelativeKey?: string): string {
  const subComponent =
    direction === MessageDirection.TOWARDS_INTERNET ? 'internet-bound' : 'endpoint-bound';
  const trailingComponents = parcelRelativeKey ? [parcelRelativeKey] : [];
  return join(ParcelStore.FILE_STORE_PREFIX, subComponent, ...trailingComponents);
}

async function wasEndpointBoundParcelCollected(
  parcel: Parcel,
  collectionRepo: Repository<ParcelCollection>,
): Promise<boolean> {
  const parcelCollectionsCount = await collectionRepo.countBy({
    parcelId: parcel.id,
    recipientEndpointId: parcel.recipient.id,
    senderEndpointId: await parcel.senderCertificate.calculateSubjectId(),
  });
  return 0 < parcelCollectionsCount;
}

function isAlphaNumeric(string: string): boolean {
  return /^[\w-]+$/.test(string);
}
