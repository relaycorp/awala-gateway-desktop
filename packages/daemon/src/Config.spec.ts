import { Container, Token } from 'typedi';
import { getConnection, Repository } from 'typeorm';
import { Config } from './Config';

import { ConfigItem } from './entity/ConfigItem';
import { ConfigError } from './errors';
import { setUpTestDBConnection } from './testUtils/db';

setUpTestDBConnection();

let config: Config;
let configRepository: Repository<ConfigItem>;
beforeEach(() => {
  const connection = getConnection();
  configRepository = connection.getRepository(ConfigItem);
  config = new Config(configRepository);
});

const TOKEN = new Token<string>('the-token');
const VALUE = 'foo';

function removeToken(): void {
  Container.remove(TOKEN);
}
beforeEach(removeToken);
afterAll(removeToken);

describe('load', () => {
  test('Missing key should raise an error', async () => {
    const nonExistingToken = new Token<string>('baz');

    await expect(config.load([nonExistingToken])).rejects.toEqual(
      new ConfigError(`Token "baz" was not found on the DB`),
    );
  });

  test('Existing key should be set', async () => {
    await config.set(TOKEN, VALUE);
    Container.remove(TOKEN);

    await config.load([TOKEN]);

    expect(Container.get(TOKEN)).toEqual(VALUE);
  });
});

describe('set', () => {
  test('Missing key should be created', async () => {
    await config.set(TOKEN, VALUE);

    await expect(configRepository.findOne(TOKEN.name)).resolves.toHaveProperty('value', VALUE);
  });

  test('Existing key should be replaced', async () => {
    const newValue = VALUE + ' new';

    await config.set(TOKEN, VALUE);
    await config.set(TOKEN, newValue);

    await expect(configRepository.findOne(TOKEN.name)).resolves.toHaveProperty('value', newValue);
  });

  test('Token value should be saved', async () => {
    await config.set(TOKEN, VALUE);

    expect(Container.get(TOKEN)).toEqual(VALUE);
  });
});
