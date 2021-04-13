import { createConnection, getConnectionOptions } from 'typeorm';

import { makeServer, runServer } from './server';
import { makeLogger } from './utils/logging';

const IS_TYPESCRIPT = __filename.endsWith('.ts');

export default async function (): Promise<void> {
  await createDBConnection();
  const server = await makeServer(makeLogger());
  await runServer(server);
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
