import envPaths from 'env-paths';
import { Container } from 'typedi';
import { createConnection, getConnectionOptions } from 'typeorm';

import { makeServer, runServer } from './server';
import { APP_DIRS } from './tokens';
import { makeLogger } from './utils/logging';

const IS_TYPESCRIPT = __filename.endsWith('.ts');

const APP_NAME = 'AwalaGateway';

export default async function (): Promise<void> {
  await setUpDependencyInjection();

  const server = await makeServer(makeLogger());
  await runServer(server);
}

async function setUpDependencyInjection(): Promise<void> {
  setUpPaths();
  await createDBConnection();
}

function setUpPaths(): void {
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
