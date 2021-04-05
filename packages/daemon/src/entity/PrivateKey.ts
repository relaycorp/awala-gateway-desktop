import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum PrivateKeyType {
  NODE = 'node',
  SESSION_INITIAL = 'session-initial',
  SESSION_SUBSEQUENT = 'session-subsequent',
}

@Entity()
export class PrivateKey {
  @PrimaryColumn()
  public readonly id!: string;

  @Column()
  public readonly derSerialization!: Buffer;

  @Column({ type: 'simple-enum', enum: PrivateKeyType })
  public readonly type!: PrivateKeyType;

  @CreateDateColumn()
  public readonly creationDate!: Date;

  @Column({ type: 'blob', nullable: true })
  public readonly certificateDer!: Buffer | null;

  @Column({ type: 'varchar', nullable: true })
  public readonly recipientPublicKeyDigest!: string | null;
}
