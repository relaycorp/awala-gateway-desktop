import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class PublicKey {
  @PrimaryColumn()
  public readonly peerPrivateAddress!: string;

  @Column()
  public readonly id!: Buffer;

  @Column()
  public readonly derSerialization!: Buffer;

  @Column()
  public readonly creationDate!: Date;
}
