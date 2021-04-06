// tslint:disable:max-classes-per-file

import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { InjectRepository } from 'typeorm-typedi-extensions';

import { ConfigItem } from './entity/ConfigItem';

@Service()
export class Config {
  constructor(@InjectRepository(ConfigItem) private configRepository: Repository<ConfigItem>) {}

  public async get(key: ConfigKey): Promise<string | null> {
    const item = await this.configRepository.findOne(key.name);
    return item?.value ?? null;
  }

  public async set(key: ConfigKey, value: string): Promise<void> {
    const configItem = await this.configRepository.create({ key: key.name, value });
    await this.configRepository.save(configItem);
  }
}

export class ConfigKey {
  constructor(public name: string) {}
}
