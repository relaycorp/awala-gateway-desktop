import { Container } from 'typedi';

import { StatusMonitor } from '../sync/StatusMonitor';

export function restoreStatusMonitor(): void {
  const statusMonitor = Container.get(StatusMonitor);

  const restoreStatus = () => {
    statusMonitor._reset();
  };
  beforeEach(restoreStatus);
  afterAll(restoreStatus);
}
