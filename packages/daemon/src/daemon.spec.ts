import * as typeorm from 'typeorm';

import daemon from './daemon';
import { makeServer, runServer } from './server';
import { mockSpy } from './testUtils/jest';
import { makeMockLogging, MockLogging } from './testUtils/logging';
import * as logging from './utils/logging';

jest.mock('./server');

const mockCreateConnection = mockSpy(jest.spyOn(typeorm, 'createConnection'));

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
