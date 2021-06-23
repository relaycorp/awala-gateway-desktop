import { useTemporaryAppDirs } from '../testUtils/appDirs';
import { setUpTestDBConnection } from '../testUtils/db';
import { mockSpy } from '../testUtils/jest';
import { mockLoggerToken } from '../testUtils/logging';
import runSync from './index';
import { GatewayRegistrar } from './publicGateway/GatewayRegistrar';
import { ParcelDeliveryManager } from './publicGateway/parcelDelivery/ParcelDeliveryManager';
import { StatusMonitor } from './StatusMonitor';

setUpTestDBConnection();
useTemporaryAppDirs();
mockLoggerToken();

const noOp = () => {
  // Do nothing
};

const mockStatusMonitorStart = mockSpy(jest.spyOn(StatusMonitor.prototype, 'start'), noOp);

const mockGatewayRegistrarConditionalRegistration = mockSpy(
  jest.spyOn(GatewayRegistrar.prototype, 'registerIfUnregistered'),
  noOp,
);

const mockParcelDeliveryManagerStart = mockSpy(
  jest.spyOn(ParcelDeliveryManager.prototype, 'deliverWhileConnected'),
  noOp,
);

describe('runSync', () => {
  test('Status monitor should be started', async () => {
    expect(mockStatusMonitorStart).not.toBeCalled();

    await runSync();

    expect(mockStatusMonitorStart).toBeCalled();
  });

  test('Parcel Delivery Manager should be started', async () => {
    expect(mockParcelDeliveryManagerStart).not.toBeCalled();

    await runSync();

    expect(mockParcelDeliveryManagerStart).toBeCalled();
  });

  test('Gateway should be registered if necessary', async () => {
    await runSync();

    expect(mockGatewayRegistrarConditionalRegistration).toBeCalled();
  });
});
