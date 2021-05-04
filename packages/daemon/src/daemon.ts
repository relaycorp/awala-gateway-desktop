import envPaths from 'env-paths';
import { join } from 'path';
import pino, { Logger } from 'pino';
import { Container } from 'typedi';
import { ConnectionOptions, createConnection, getConnectionOptions } from 'typeorm';

import { makeServer, runServer } from './server';
import runSync from './sync';
import { APP_DIRS, LOGGER } from './tokens';
import { makeLogger } from './utils/logging';

const IS_TYPESCRIPT = __filename.endsWith('.ts');

const DB_FILE_NAME = 'db.sqlite';

const APP_NAME = 'AwalaGateway';

export default async function (): Promise<void> {
  const logger = makeLogger();
  logger.info('Starting daemon...');

  process.on(
    'uncaughtException',
    pino.final(logger, (err, finalLogger) => {
      finalLogger.fatal({ err }, 'uncaughtException');
      process.exit(1);
    }),
  );
  process.on(
    'unhandledRejection',
    pino.final(logger, (err, finalLogger) => {
      finalLogger.fatal({ err }, 'uncaughtException');
      process.exit(1);
    }) as any,
  );
  process.on('beforeExit', (code) => {
    logger.info({ code }, 'beforeExit');
  });

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
  const { data: dataPath } = Container.get(APP_DIRS);
  const originalConnectionOptions = await getConnectionOptions();
  /* istanbul ignore next */
  const entityDirPath = join(__dirname, 'entity', '**', IS_TYPESCRIPT ? '*.ts' : '*.js');
  const connectionOptions = {
    ...originalConnectionOptions,
    database: join(dataPath, DB_FILE_NAME),
    entities: [entityDirPath],
  };
  await createConnection(connectionOptions as ConnectionOptions);
}
