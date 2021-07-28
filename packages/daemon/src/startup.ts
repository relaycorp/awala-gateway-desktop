import { PrivateKey, PublicKey } from '@relaycorp/keystore-db';
import envPaths, { Paths } from 'env-paths';
import { promises as fs } from 'fs';
import { join } from 'path';
import pino, { Logger } from 'pino';
import { Container } from 'typedi';
import { ConnectionOptions, createConnection, getConnectionOptions } from 'typeorm';

import { APP_DIRS, LOGGER } from './tokens';
import { makeLogger } from './utils/logging';

const IS_TYPESCRIPT = __filename.endsWith('.ts');

const DB_FILE_NAME = 'db.sqlite';

const APP_NAME = 'AwalaGateway';

export default async function runStartup(componentName: string): Promise<void> {
  const paths = envPaths(APP_NAME, { suffix: '' });
  await createPaths(paths);

  const logger = makeLogger(componentName, paths.log);
  registerExitHandler(logger);

  await registerTokens(logger, paths);

  await createDBConnection();
}

async function createPaths(paths: Paths): Promise<void> {
  const neededPaths: readonly string[] = [paths.data, paths.log];
  await Promise.all(neededPaths.map((p) => fs.mkdir(p, { recursive: true })));
}

function registerExitHandler(logger: Logger): void {
  const handler = (logMessage: string) =>
    pino.final(logger, (err, finalLogger) => {
      finalLogger.fatal({ err }, logMessage);

      process.exit(128);
    });

  process.once('uncaughtException', handler('uncaughtException'));
  process.once('unhandledRejection', handler('unhandledRejection') as any);
}

async function registerTokens(logger: Logger, paths: Paths): Promise<void> {
  Container.set(LOGGER, logger);
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
    entities: [entityDirPath, PrivateKey, PublicKey],
  };
  await createConnection(connectionOptions as ConnectionOptions);
}
