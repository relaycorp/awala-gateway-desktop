import { PassThrough } from 'stream';
import { Container } from 'typedi';

import { useTemporaryAppDirs } from '../../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../../testUtils/db';
import { arrayToAsyncIterable } from '../../../testUtils/iterables';
import { mockSpy } from '../../../testUtils/jest';
import { setImmediateAsync } from '../../../testUtils/timing';
import * as child from '../../../utils/subprocess/child';
import { ParcelCollectorManager } from '../parcelCollection/ParcelCollectorManager';
import { PublicGatewayCollectionStatus } from '../PublicGatewayCollectionStatus';
import { ParcelDeliveryManager } from './ParcelDeliveryManager';

setUpTestDBConnection();
useTemporaryAppDirs();

const mockPubGatewayStatusStream = mockSpy(
  jest.spyOn(ParcelCollectorManager.prototype, 'streamStatus'),
  () => arrayToAsyncIterable([]),
);

let subprocessStream: PassThrough;
beforeEach(() => {
  subprocessStream = new PassThrough({ objectMode: true });
});
afterEach(async () => {
  subprocessStream.destroy();
});
const mockFork = mockSpy(jest.spyOn(child, 'fork'), () => subprocessStream);

let parcelDeliveryManager: ParcelDeliveryManager;
beforeEach(() => {
  const parcelCollectorManager = Container.get(ParcelCollectorManager);
  parcelDeliveryManager = new ParcelDeliveryManager(parcelCollectorManager);
});

describe('deliverWhileConnected', () => {
  test('Subprocess should never be started if we cannot reach the public gateway', async () => {
    mockPubGatewayStatusStream.mockReturnValue(
      arrayToAsyncIterable([PublicGatewayCollectionStatus.DISCONNECTED]),
    );

    await parcelDeliveryManager.deliverWhileConnected();

    await setImmediateAsync();
    expect(mockFork).not.toBeCalled();
  });

  test('Subprocess should be started when public gateway can be reached', async () => {
    mockPubGatewayStatusStream.mockReturnValue(
      arrayToAsyncIterable([
        PublicGatewayCollectionStatus.DISCONNECTED,
        PublicGatewayCollectionStatus.CONNECTED,
      ]),
    );

    await parcelDeliveryManager.deliverWhileConnected();

    await setImmediateAsync();
    expect(mockFork).toBeCalledWith('parcel-delivery');
    expect(subprocessStream.destroyed).toBeFalse();
  });

  test('Subprocess should not be started again if an instance is running', async () => {
    mockPubGatewayStatusStream.mockReturnValue(
      arrayToAsyncIterable([
        PublicGatewayCollectionStatus.DISCONNECTED,
        PublicGatewayCollectionStatus.CONNECTED,
        PublicGatewayCollectionStatus.CONNECTED,
      ]),
    );

    await parcelDeliveryManager.deliverWhileConnected();

    await setImmediateAsync();
    expect(mockFork).toBeCalledTimes(1);
  });

  test('Subprocess should be killed when connection to public gateway is lost', async () => {
    mockPubGatewayStatusStream.mockReturnValue(
      arrayToAsyncIterable([
        PublicGatewayCollectionStatus.CONNECTED,
        PublicGatewayCollectionStatus.DISCONNECTED,
      ]),
    );

    await parcelDeliveryManager.deliverWhileConnected();

    await setImmediateAsync();
    expect(subprocessStream.destroyed).toBeTrue();
  });

  test('Subprocess should not be attempted to be killed if it is not running', async () => {
    mockPubGatewayStatusStream.mockReturnValue(
      arrayToAsyncIterable([
        PublicGatewayCollectionStatus.CONNECTED,
        PublicGatewayCollectionStatus.DISCONNECTED,
        PublicGatewayCollectionStatus.DISCONNECTED,
      ]),
    );

    await parcelDeliveryManager.deliverWhileConnected();

    await setImmediateAsync();
    expect(subprocessStream.destroyed).toBeTrue();
  });
});

describe('notifyAboutNewParcel', () => {
  test('Notification should be skipped while disconnected', async () => {
    let notificationsCount = 0;
    subprocessStream.on('data', () => {
      notificationsCount += 1;
    });

    await parcelDeliveryManager.deliverWhileConnected();
    parcelDeliveryManager.notifyAboutNewParcel('whatever');

    await setImmediateAsync();
    expect(notificationsCount).toEqual(0);
  });

  test('Notification should be sent if connected', async () => {
    mockPubGatewayStatusStream.mockReturnValue(
      arrayToAsyncIterable([
        PublicGatewayCollectionStatus.DISCONNECTED,
        PublicGatewayCollectionStatus.CONNECTED,
      ]),
    );
    // tslint:disable-next-line:readonly-array
    const notifications: string[] = [];
    subprocessStream.on('data', (data) => {
      notifications.push(data);
    });
    const parcelKey = 'whatever';

    await parcelDeliveryManager.deliverWhileConnected();
    parcelDeliveryManager.notifyAboutNewParcel(parcelKey);

    await setImmediateAsync();
    expect(notifications).toEqual([parcelKey]);
  });
});
