import envPaths from 'env-paths';
import { Logger } from 'pino';
import { Container } from 'typedi';
import { createConnection, getConnectionOptions } from 'typeorm';

import { makeServer, runServer } from './server';
import runSync from './sync';
import { APP_DIRS, LOGGER } from './tokens';
import { makeLogger } from './utils/logging';

const IS_TYPESCRIPT = __filename.endsWith('.ts');

const APP_NAME = 'AwalaGateway';

export default async function (): Promise<void> {
  const logger = makeLogger();

  await registerTokens(logger);
  await createDBConnection();

  const server = await makeServer(logger);
  await Promise.all([runServer(server), runSync()]);
}

async function registerTokens(logger: Logger): Promise<void> {
  Container.set(LOGGER, logger);

  const paths = envPaths(APP_NAME, { suffix: '' });
  Container.set(APP_DIRS, paths);
}

async function createDBConnection(): Promise<void> {
  const originalConnectionOptions = await getConnectionOptions();
  /* istanbul ignore next */
  const connectionOptions = {
    ...originalConnectionOptions,
    ...(!IS_TYPESCRIPT && { entities: ['build/entity/**/*.js'] }),
  };
  await createConnection(connectionOptions);
}
