import { join } from 'path';
import { Container } from 'typedi';
import * as typeorm from 'typeorm';

import envPaths from 'env-paths';
import daemon from './daemon';
import { makeServer, runServer } from './server';
import runSync from './sync';
import { mockSpy } from './testUtils/jest';
import { makeMockLogging, MockLogging } from './testUtils/logging';
import { mockToken } from './testUtils/tokens';
import { APP_DIRS, LOGGER } from './tokens';
import * as logging from './utils/logging';

jest.mock('./server');
jest.mock('./sync');

const mockCreateConnection = mockSpy(jest.spyOn(typeorm, 'createConnection'));

mockToken(APP_DIRS);
mockToken(LOGGER);

let mockLogging: MockLogging;
beforeEach(() => {
  mockLogging = makeMockLogging();
});
mockSpy(jest.spyOn(logging, 'makeLogger'), () => mockLogging.logger);

test('Logger should be enabled by default', async () => {
  await daemon();

  expect(makeServer).toBeCalledWith(mockLogging.logger);
});

test('Server should be run', async () => {
  await daemon();

  expect(runServer).toBeCalled();
});

test('Sync should be run', async () => {
  await daemon();

  expect(runSync).toBeCalled();
});

describe('Token registration', () => {
  test('APP_DIRS', async () => {
    expect(Container.has(APP_DIRS)).toBeFalse();

    await daemon();

    const expectedPaths = envPaths('AwalaGateway', { suffix: '' });
    expect(Container.get(APP_DIRS)).toEqual(expectedPaths);
  });

  test('LOGGER', async () => {
    expect(Container.has(LOGGER)).toBeFalse();

    await daemon();

    expect(Container.get(LOGGER)).toBe(mockLogging.logger);
  });
});

test('DB connection should be established', async () => {
  const originalConnectionOptions = await typeorm.getConnectionOptions();

  await daemon();

  const expectedPaths = envPaths('AwalaGateway', { suffix: '' });
  const entitiesDir = __filename.endsWith('.ts')
    ? join(__dirname, 'entity', '**', '*.ts')
    : join(__dirname, 'entity', '**', '*.js');
  const dbPath = join(expectedPaths.data, 'db.sqlite');
  expect(mockCreateConnection).toBeCalledWith({
    ...originalConnectionOptions,
    database: dbPath,
    entities: [entitiesDir],
  });
  expect(mockCreateConnection).toHaveBeenCalledBefore(makeServer as any);
});
