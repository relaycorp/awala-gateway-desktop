import { Container } from 'typedi';
import { ConnectionStatus, StatusMonitor } from '../sync/StatusMonitor';

export function restoreStatusMonitor(): void {
  const statusMonitor = Container.get(StatusMonitor);

  let originalStatus: ConnectionStatus;
  beforeAll(() => {
    originalStatus = statusMonitor.getLastStatus();
  });

  const restoreStatus = () => {
    statusMonitor.setLastStatus(originalStatus);
  };
  beforeEach(restoreStatus);
  afterAll(restoreStatus);
}
