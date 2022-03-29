import { useTemporaryAppDirs } from '../testUtils/appDirs';
import { setUpTestDBConnection } from '../testUtils/db';
import { mockSpy } from '../testUtils/jest';
import { mockLoggerToken } from '../testUtils/logging';
import runSync from './index';
import { GatewayRegistrar } from './publicGateway/GatewayRegistrar';
import { ParcelCollectorManager } from './publicGateway/parcelCollection/ParcelCollectorManager';
import { ParcelDeliveryManager } from './publicGateway/parcelDelivery/ParcelDeliveryManager';
import { StatusMonitor } from './StatusMonitor';
import { arrayToAsyncIterable } from '../testUtils/iterables';

setUpTestDBConnection();
useTemporaryAppDirs();
mockLoggerToken();

const noOp = () => {
  // Do nothing
};

const mockStatusMonitorStart = mockSpy(jest.spyOn(StatusMonitor.prototype, 'start'), noOp);

const mockGatewayRegistrarConditionalRegistration = mockSpy(
  jest.spyOn(GatewayRegistrar.prototype, 'waitForRegistration'),
  noOp,
);
const mockContinuallyRenewRegistration = mockSpy(
  jest.spyOn(GatewayRegistrar.prototype, 'continuallyRenewRegistration'),
  () => arrayToAsyncIterable([]),
);

const mockParcelDeliveryManagerStart = mockSpy(
  jest.spyOn(ParcelDeliveryManager.prototype, 'deliverWhileConnected'),
  noOp,
);

const mockParcelCollectorManagerStart = mockSpy(
  jest.spyOn(ParcelCollectorManager.prototype, 'start'),
  noOp,
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

  test('Parcel Delivery Manager should be started', async () => {
    expect(mockParcelDeliveryManagerStart).not.toBeCalled();

    await runSync();

    expect(mockParcelDeliveryManagerStart).toBeCalled();
    expect(mockParcelDeliveryManagerStart).toHaveBeenCalledAfter(
      mockGatewayRegistrarConditionalRegistration as any,
    );
  });

  test('Parcel Collector Manager should be started', async () => {
    expect(mockParcelCollectorManagerStart).not.toBeCalled();

    await runSync();

    expect(mockParcelCollectorManagerStart).toBeCalled();
    expect(mockParcelCollectorManagerStart).toHaveBeenCalledAfter(
      mockGatewayRegistrarConditionalRegistration as any,
    );
  });

  test('Registration with public gateway should be continuously renewed', async () => {
    expect(mockContinuallyRenewRegistration).not.toBeCalled();
    let wasIterableConsumed = false;
    mockContinuallyRenewRegistration.mockImplementation(async function* (): AsyncIterable<void> {
      yield;
      wasIterableConsumed = true;
    });

    await runSync();

    expect(mockContinuallyRenewRegistration).toBeCalled();
    expect(wasIterableConsumed).toBeTrue();
    expect(mockContinuallyRenewRegistration).toHaveBeenCalledAfter(
      mockGatewayRegistrarConditionalRegistration as any,
    );
  });
});
