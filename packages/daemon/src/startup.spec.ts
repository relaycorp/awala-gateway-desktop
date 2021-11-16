import { PrivateKey, PublicKey } from '@relaycorp/keystore-db';
import { promises as fs } from 'fs';
import { join } from 'path';
import pino from 'pino';
import { Container } from 'typedi';
import { ConnectionOptions, getConnection } from 'typeorm';

import envPaths from 'env-paths';
import startUp from './startup';
import { mockSpy } from './testUtils/jest';
import { makeMockLoggingFixture, partialPinoLog } from './testUtils/logging';
import { makeProcessOnceMock } from './testUtils/process';
import { mockToken } from './testUtils/tokens';
import { APP_DIRS, LOGGER } from './tokens';
import * as logging from './utils/logging';

mockToken(APP_DIRS);

mockToken(LOGGER);
const mockLogging = makeMockLoggingFixture();
const mockFinalLogging = makeMockLoggingFixture();
mockSpy(jest.spyOn(logging, 'makeLogger'), () => mockLogging.logger);

afterEach(async () => {
  await getConnection().close();
});

const mockMkdir = mockSpy(jest.spyOn(fs, 'mkdir'));

const getProcessOnceHandler = makeProcessOnceMock();
const mockProcessExit = mockSpy(jest.spyOn(process, 'exit'));

mockSpy(
  jest.spyOn(pino, 'final'),
  (_, handler) => (err: Error) => handler(err, mockFinalLogging.logger),
);

const PATHS = envPaths('AwalaGateway', { suffix: '' });

const COMPONENT_NAME = 'the-component';

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

  describe('Exit handling', () => {
    const ERROR = new Error('Oh noes');

    test.each(['uncaughtException', 'unhandledRejection'])(
      '%s should be logged and end the process with code 128',
      async (eventName) => {
        await startUp(COMPONENT_NAME);
        const handler = getProcessOnceHandler(eventName);

        handler(ERROR);

        expect(mockLogging.logs).toBeEmpty();
        expect(mockFinalLogging.logs).toContainEqual(
          partialPinoLog('fatal', eventName, {
            err: expect.objectContaining({ message: ERROR.message }),
          }),
        );
        expect(mockProcessExit).toBeCalledWith(128);
      },
    );
  });
});

test('DB connection should be established', async () => {
  expect(getConnection().isConnected).toBeFalse();

  await startUp(COMPONENT_NAME);

  const entitiesDir = __filename.endsWith('.ts')
    ? join(__dirname, 'entity', '**', '*.ts')
    : join(__dirname, 'entity', '**', '*.js');
  const dbPath = join(PATHS.data, 'db.sqlite');
  const connection = getConnection();
  expect(connection.isConnected).toBeTrue();
  expect(connection.options).toMatchObject<Partial<ConnectionOptions>>({
    database: dbPath,
    entities: [entitiesDir, PrivateKey, PublicKey],
    logging: false,
    synchronize: true,
    type: 'sqlite',
  });
});
