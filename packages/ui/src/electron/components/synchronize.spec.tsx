import { render } from "@testing-library/react";
import React from 'react';
import { CourierSyncError, CourierSyncStatus, synchronizeWithCourier } from '../../ipc/courierSync';
import Synchronize from './synchronize';

jest.mock('../../ipc/courierSync');

describe('Synchronize', () => {
  test('renders', async () => {
    (synchronizeWithCourier as jest.Mock).mockReturnValue({
      promise: (async function* (): AsyncIterable<CourierSyncStatus> {
        yield CourierSyncStatus.COLLECTING_CARGO;
      })()
    })

    const onComplete = jest.fn();
    const onReset = jest.fn();
    const el = render(<Synchronize token={"TOKEN"} onComplete={onComplete} onReset={onReset}/>);
    expect(el.container.firstChild).toBeTruthy();
  });
  test('renders on an error', async () => {
    (synchronizeWithCourier as jest.Mock).mockReturnValue({
      promise: (async function* fakeSource(): AsyncIterable<CourierSyncStatus> {
        throw new CourierSyncError('error');
      })()
    })

    const onComplete = jest.fn();
    const onReset = jest.fn();
    const el = render(<Synchronize token={"TOKEN"} onComplete={onComplete} onReset={onReset}/>);
    expect(el.container.firstChild).toBeTruthy();
  });
  test('aborts on unmount', async () => {
    const abort = jest.fn();
    (synchronizeWithCourier as jest.Mock).mockReturnValue({
      abort,
      promise: (async function* fakeSource(): AsyncIterable<CourierSyncStatus> {
        return;
      })(),
    })

    const onComplete = jest.fn();
    const onReset = jest.fn();
    const el = render(<Synchronize token={"TOKEN"} onComplete={onComplete} onReset={onReset}/>);
    el.unmount();
    expect(abort).toHaveBeenCalledTimes(1);
  });
});
