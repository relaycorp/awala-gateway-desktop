import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class ConfigItem {
  @PrimaryColumn()
  public readonly key!: string;

  @Column()
  public readonly value!: string;
}
