// tslint:disable:readonly-keyword
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum PrivateKeyType {
  NODE = 'node',
  SESSION_INITIAL = 'session-initial',
  SESSION_SUBSEQUENT = 'session-subsequent',
}

@Entity()
export class PrivateKey {
  @PrimaryColumn()
  public id!: string;

  @Column()
  public derSerialization!: Buffer;

  @Column({ type: 'simple-enum', enum: PrivateKeyType })
  public type!: PrivateKeyType;

  @CreateDateColumn()
  public creationDate!: Date;

  @Column({ type: 'blob', nullable: true })
  public certificateDer!: Buffer | null;

  @Column({ type: 'varchar', nullable: true })
  public recipientPublicKeyDigest!: string | null;
}
