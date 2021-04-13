import { createConnection } from 'typeorm';

import { makeServer, runServer } from './server';
import { makeLogger } from './utils/logging';

export default async function (): Promise<void> {
  await createConnection();
  const server = await makeServer(makeLogger());
  await runServer(server);
}
