import { makeServer, runServer } from './server';
import startup from './startup';
import runSync from './sync';

export default async function (): Promise<void> {
  await startup('daemon');

  const server = await makeServer();
  await Promise.all([runServer(server), runSync()]);
}
