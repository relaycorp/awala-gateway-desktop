import { useTemporaryAppDirs } from '../testUtils/appDirs';
import { setUpTestDBConnection } from '../testUtils/db';
import { mockSpy } from '../testUtils/jest';
import runSync from './index';
import { GatewayRegistrar } from './publicGateway/GatewayRegistrar';
import { StatusMonitor } from './StatusMonitor';

setUpTestDBConnection();
useTemporaryAppDirs();

const mockStatusMonitorStart = mockSpy(jest.spyOn(StatusMonitor.prototype, 'start'));

const mockGatewayRegistrarConditionalRegistration = mockSpy(
  jest.spyOn(GatewayRegistrar.prototype, 'registerIfUnregistered'),
  () => {
    // Do nothing
  },
);

describe('runSync', () => {
  test('Status monitor should be started', async () => {
    expect(mockStatusMonitorStart).not.toBeCalled();

    await runSync();

    expect(mockStatusMonitorStart).toBeCalled();
  });

  test('Gateway should be registered if necessary', async () => {
    await runSync();

    expect(mockGatewayRegistrarConditionalRegistration).toBeCalled();
  });
});
