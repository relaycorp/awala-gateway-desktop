import { promises as fs } from 'fs';
import { join } from 'path';
import { Container } from 'typedi';
import * as typeorm from 'typeorm';

import envPaths from 'env-paths';
import startUp from './startup';
import { mockSpy } from './testUtils/jest';
import { makeMockLogging, MockLogging } from './testUtils/logging';
import { mockToken } from './testUtils/tokens';
import { APP_DIRS, LOGGER } from './tokens';
import * as logging from './utils/logging';

const mockCreateConnection = mockSpy(jest.spyOn(typeorm, 'createConnection'));

mockToken(APP_DIRS);
mockToken(LOGGER);

let mockLogging: MockLogging;
beforeEach(() => {
  mockLogging = makeMockLogging();
});
mockSpy(jest.spyOn(logging, 'makeLogger'), () => mockLogging.logger);

const mockMkdir = mockSpy(jest.spyOn(fs, 'mkdir'));

const PATHS = envPaths('AwalaGateway', { suffix: '' });

const COMPONENT_NAME = 'the-component'

describe('App directories', () => {
  test('Data directory should be created', async () => {
    await startUp(COMPONENT_NAME);

    expect(mockMkdir).toBeCalledWith(PATHS.data, { recursive: true });
  });

  test('Log directory should be created', async () => {
    await startUp(COMPONENT_NAME);

    expect(mockMkdir).toBeCalledWith(PATHS.log, { recursive: true });
  });

  test('APP_DIRS token should be registered', async () => {
    expect(Container.has(APP_DIRS)).toBeFalse();

    await startUp(COMPONENT_NAME);

    expect(Container.get(APP_DIRS)).toEqual(PATHS);
  });
});

describe('Logging', () => {
  test('Logger factory should receive path to log directory', async () => {
    await startUp(COMPONENT_NAME);

    expect(logging.makeLogger).toBeCalledWith(COMPONENT_NAME, PATHS.log);
  });

  test('LOGGER token should be registered', async () => {
    expect(Container.has(LOGGER)).toBeFalse();

    await startUp(COMPONENT_NAME);

    expect(Container.get(LOGGER)).toBe(mockLogging.logger);
  });
});

test('DB connection should be established', async () => {
  const originalConnectionOptions = await typeorm.getConnectionOptions();

  await startUp(COMPONENT_NAME);

  const entitiesDir = __filename.endsWith('.ts')
    ? join(__dirname, 'entity', '**', '*.ts')
    : join(__dirname, 'entity', '**', '*.js');
  const dbPath = join(PATHS.data, 'db.sqlite');
  expect(mockCreateConnection).toBeCalledWith({
    ...originalConnectionOptions,
    database: dbPath,
    entities: [entitiesDir],
  });
});
