import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A parcel collection from the public gateway to this private gateway (not the other way around).
 */
@Entity()
export class ParcelCollection {
  @PrimaryColumn()
  public readonly senderEndpointId!: string;

  @PrimaryColumn()
  public readonly recipientEndpointId!: string;

  @PrimaryColumn()
  public readonly parcelId!: string;

  @Column()
  public readonly parcelExpiryDate!: Date;
}
