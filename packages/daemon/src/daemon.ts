import { Container } from 'typedi';

import { makeServer, runServer } from './server';
import startup from './startup';
import runSync from './sync';
import { LOGGER } from './tokens';

export default async function (): Promise<void> {
  await startup();

  const logger = Container.get(LOGGER);
  const server = await makeServer(logger);
  await Promise.all([runServer(server), runSync()]);
}
