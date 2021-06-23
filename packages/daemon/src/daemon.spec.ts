import daemon from './daemon';
import { makeServer, runServer } from './server';
import startup from './startup';
import runSync from './sync';
import { mockLoggerToken } from './testUtils/logging';

jest.mock('./server');
jest.mock('./sync');
jest.mock('./startup');

mockLoggerToken();

test('Startup routine should be called', async () => {
  await daemon();

  expect(startup).toBeCalledWith('daemon');
});

test('Server should be run', async () => {
  await daemon();

  expect(makeServer).toBeCalledWith();
  expect(runServer).toHaveBeenCalledAfter(startup as any);
});

test('Sync should be run', async () => {
  await daemon();

  expect(runSync).toHaveBeenCalledAfter(startup as any);
});
