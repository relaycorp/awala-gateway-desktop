import { Container } from 'typedi';

import { StatusMonitor } from './StatusMonitor';

export default async function runSync(): Promise<void> {
  const statusMonitor = Container.get(StatusMonitor);

  await statusMonitor.start();
}
