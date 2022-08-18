import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { InjectRepository } from 'typeorm-typedi-extensions';

import { ConfigItem } from './entity/ConfigItem';

export enum ConfigKey {
  CURRENT_ID = 'current_id',
  INTERNET_GATEWAY_ID = 'internet_gateway_id',
  INTERNET_GATEWAY_ADDRESS = 'internet_gateway_address',
}

@Service()
export class Config {
  constructor(@InjectRepository(ConfigItem) private configRepository: Repository<ConfigItem>) {}

  public async get(key: ConfigKey): Promise<string | null> {
    const item = await this.configRepository.findOneBy({ key });
    return item?.value ?? null;
  }

  public async set(key: ConfigKey, value: string): Promise<void> {
    const configItem = await this.configRepository.create({ key, value });
    await this.configRepository.save(configItem);
  }
}
