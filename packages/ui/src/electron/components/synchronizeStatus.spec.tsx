import { fireEvent, render, screen } from "@testing-library/react";
import React from 'react';
import { CourierSyncStatus } from '../../ipc/courierSync';
import SynchronizeStatus from './synchronizeStatus';

describe('SynchronizeStatus', () => {
  const onComplete = jest.fn();
  const onReset = jest.fn();
  test('renders collecting cargo', async () => {
    render(
      <SynchronizeStatus
        status={CourierSyncStatus.COLLECTING_CARGO}
        error={false}
        onComplete={onComplete}
        onReset={onReset}
      />
    );
    expect(screen.getByText("Collecting data...")).toBeInTheDocument();
  });
  test('renders delivering cargo', async () => {
    render(
      <SynchronizeStatus
        status={CourierSyncStatus.DELIVERING_CARGO}
        error={false}
        onComplete={onComplete}
        onReset={onReset}
      />
    );
    expect(screen.getByText("Delivering data...")).toBeInTheDocument();
  });
  test('renders waiting for cargo', async () => {
    render(
      <SynchronizeStatus
        status={CourierSyncStatus.WAITING}
        error={false}
        onComplete={onComplete}
        onReset={onReset}
      />
    );
    expect(screen.getByText("Waiting for the incoming data to become available ...")).toBeInTheDocument();
  });
  test('renders complete', async () => {
    render(
      <SynchronizeStatus
        status={CourierSyncStatus.COMPLETE}
        error={false}
        onComplete={onComplete}
        onReset={onReset}
      />
    );
    expect(screen.getByText("Done!")).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  test('renders error', async () => {
    render(
      <SynchronizeStatus
        status={CourierSyncStatus.COMPLETE}
        error={true}
        onComplete={onComplete}
        onReset={onReset}
      />
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Try Again'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
