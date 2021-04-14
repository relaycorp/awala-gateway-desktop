import { Container } from 'typedi';
import * as typeorm from 'typeorm';

import envPaths from 'env-paths';
import daemon from './daemon';
import { makeServer, runServer } from './server';
import { mockSpy } from './testUtils/jest';
import { makeMockLogging, MockLogging } from './testUtils/logging';
import { mockToken } from './testUtils/tokens';
import { APP_DIRS } from './tokens';
import * as logging from './utils/logging';

jest.mock('./server');

const mockCreateConnection = mockSpy(jest.spyOn(typeorm, 'createConnection'));

mockToken(APP_DIRS);

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

test('APP_DIRS token should be set', async () => {
  expect(Container.has(APP_DIRS)).toBeFalse();

  await daemon();

  const expectedPaths = envPaths('AwalaGateway', { suffix: '' });
  expect(Container.get(APP_DIRS)).toEqual(expectedPaths);
});

test('DB connection should be established', async () => {
  const originalConnectionOptions = await typeorm.getConnectionOptions();

  await daemon();

  const isTypescript = __filename.endsWith('.ts');
  expect(mockCreateConnection).toBeCalledWith({
    ...originalConnectionOptions,
    ...(!isTypescript && { entities: ['build/entity/**/*.js'] }),
  });
  expect(mockCreateConnection).toHaveBeenCalledBefore(makeServer as any);
});
