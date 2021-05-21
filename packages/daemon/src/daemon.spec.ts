import { Container } from 'typedi';

import daemon from './daemon';
import { makeServer, runServer } from './server';
import startup from './startup';
import runSync from './sync';
import { mockLoggerToken } from './testUtils/logging';
import { LOGGER } from './tokens';

jest.mock('./server');
jest.mock('./sync');
jest.mock('./startup');

mockLoggerToken();

test('Startup routine should be called', async () => {
  await daemon();

  expect(startup).toBeCalled();
});

test('Server should be run', async () => {
  await daemon();

  const logger = Container.get(LOGGER);
  expect(makeServer).toBeCalledWith(logger);
  expect(runServer).toHaveBeenCalledAfter(startup as any);
});

test('Sync should be run', async () => {
  await daemon();

  expect(runSync).toHaveBeenCalledAfter(startup as any);
});
