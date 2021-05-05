import envPaths, { Paths } from 'env-paths';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Logger } from 'pino';
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
  const paths = envPaths(APP_NAME, { suffix: '' });
  await createPaths(paths);
  const logger = makeLogger(paths.log);
  await registerTokens(logger, paths);

  await createDBConnection();

  const server = await makeServer(logger);
  await Promise.all([runServer(server), runSync()]);
}

async function createPaths(paths: Paths): Promise<void> {
  const neededPaths: readonly string[] = [paths.data, paths.log];
  await Promise.all(neededPaths.map((p) => fs.mkdir(p, { recursive: true })));
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
    entities: [entityDirPath],
  };
  await createConnection(connectionOptions as ConnectionOptions);
}
