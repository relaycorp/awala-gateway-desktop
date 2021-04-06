import { createConnection } from 'typeorm';

import { makeServer, runServer } from './server';
import { makeLogger } from './utils/logging';

export default async function (): Promise<void> {
  const server = await makeServer(makeLogger());
  await createConnection();
  await runServer(server);
}
