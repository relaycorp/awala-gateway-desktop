import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A parcel collection from the public gateway to this private gateway (not the other way around).
 */
@Entity()
export class ParcelCollection {
  @PrimaryColumn()
  public readonly senderEndpointPrivateAddress!: string;

  @PrimaryColumn()
  public readonly recipientEndpointAddress!: string;

  @PrimaryColumn()
  public readonly parcelId!: string;

  @Column()
  public readonly parcelExpiryDate!: Date;
}
