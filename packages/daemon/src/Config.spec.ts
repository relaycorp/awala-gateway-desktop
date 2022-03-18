import { getConnection, Repository } from 'typeorm';
import { Config, ConfigKey } from './Config';

import { ConfigItem } from './entity/ConfigItem';
import { setUpTestDBConnection } from './testUtils/db';

setUpTestDBConnection();

let config: Config;
let configRepository: Repository<ConfigItem>;
beforeEach(() => {
  const connection = getConnection();
  configRepository = connection.getRepository(ConfigItem);
  config = new Config(configRepository);
});

const TOKEN = ConfigKey.PUBLIC_GATEWAY_PUBLIC_ADDRESS;
const VALUE = 'foo';

describe('get', () => {
  test('Missing key should result in null', async () => {
    await expect(config.get(TOKEN)).resolves.toBeNull();
  });

  test('Existing key should be returned', async () => {
    await config.set(TOKEN, VALUE);

    await expect(config.get(TOKEN)).resolves.toEqual(VALUE);
  });
});

describe('set', () => {
  test('Missing key should be created', async () => {
    await config.set(TOKEN, VALUE);

    await expect(configRepository.findOne(TOKEN)).resolves.toHaveProperty('value', VALUE);
  });

  test('Existing key should be replaced', async () => {
    const newValue = VALUE + ' new';

    await config.set(TOKEN, VALUE);
    await config.set(TOKEN, newValue);

    await expect(configRepository.findOne(TOKEN)).resolves.toHaveProperty('value', newValue);
  });
});
