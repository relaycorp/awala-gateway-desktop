import { createConnection } from 'typeorm';

import daemon from './daemon';
import { makeServer, runServer } from './server';
import { mockSpy } from './testUtils/jest';
import { makeMockLogging, MockLogging } from './testUtils/logging';
import * as logging from './utils/logging';

jest.mock('typeorm');
jest.mock('./server');

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
  await daemon();

  expect(createConnection).toBeCalledWith();
});
