import { mockSpy } from '../testUtils/jest';
import runSync from './index';
import { StatusMonitor } from './StatusMonitor';

const mockStatusMonitorStart = mockSpy(jest.spyOn(StatusMonitor.prototype, 'start'));

describe('runSync', () => {
  test('Status monitor should be started', async () => {
    expect(mockStatusMonitorStart).not.toBeCalled();

    await runSync();

    expect(mockStatusMonitorStart).toBeCalled();
  });
});
