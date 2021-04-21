import { Container } from 'typedi';

import { StatusMonitor } from '../sync/StatusMonitor';

export function restoreStatusMonitor(): void {
  const restoreStatus = () => {
    const statusMonitor = Container.get(StatusMonitor);
    statusMonitor._reset();
  };
  beforeEach(restoreStatus);
  afterAll(restoreStatus);
}
