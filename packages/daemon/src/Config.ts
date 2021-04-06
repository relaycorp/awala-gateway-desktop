import { Container, Service, Token } from 'typedi';
import { Repository } from 'typeorm';
import { InjectRepository } from 'typeorm-typedi-extensions';

import { ConfigItem } from './entity/ConfigItem';
import { ConfigError } from './errors';

@Service()
export class Config {
  constructor(@InjectRepository(ConfigItem) private configRepository: Repository<ConfigItem>) {}

  public async load(tokens: ReadonlyArray<Token<string>>): Promise<void> {
    const items = await this.configRepository.findByIds(tokens.map((t) => t.name));
    const itemByKey: { readonly [key: string]: string } = items.reduce(
      (obj, item) => ({ ...obj, [item.key]: item.value }),
      {},
    );
    for (const token of tokens) {
      const value: string | undefined = itemByKey[token.name as string];
      if (!value) {
        throw new ConfigError(`Token "${token.name}" was not found on the DB`);
      }
      Container.set(token, value);
    }
  }

  public async set(key: Token<string>, value: string): Promise<void> {
    const configItem = await this.configRepository.create({ key: key.name, value });
    await this.configRepository.save(configItem);

    Container.set(key, value);
  }
}
