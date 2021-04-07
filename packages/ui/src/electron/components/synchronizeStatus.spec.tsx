import { render, screen } from "@testing-library/react";
import React from 'react';
import { CourierSyncStatus } from '../../ipc/courierSync';
import SynchronizeStatus from './synchronizeStatus';

describe('SynchronizeStatus', () => {
  function onComplete() : void {
    return;
  }
  test('renders collecting cargo', async () => {
    render(
      <SynchronizeStatus
        status={CourierSyncStatus.COLLECTING_CARGO}
        error={false}
        onComplete={onComplete}
      />
    );
    expect(screen.getByText("collecting cargo")).toBeInTheDocument();
  });
  test('renders delivering cargo', async () => {
    render(
      <SynchronizeStatus
        status={CourierSyncStatus.DELIVERING_CARGO}
        error={false}
        onComplete={onComplete}
      />
    );
    expect(screen.getByText("delivering cargo")).toBeInTheDocument();
  });
  test('renders waiting for cargo', async () => {
    render(
      <SynchronizeStatus
        status={CourierSyncStatus.WAITING}
        error={false}
        onComplete={onComplete}
      />
    );
    expect(screen.getByText("waiting")).toBeInTheDocument();
  });
  test('renders complete', async () => {
    render(
      <SynchronizeStatus
        status={CourierSyncStatus.COMPLETE}
        error={false}
        onComplete={onComplete}
      />
    );
    expect(screen.getByText("done")).toBeInTheDocument();
  });
  test('renders error', async () => {
    render(
      <SynchronizeStatus
        status={CourierSyncStatus.COMPLETE}
        error={true}
        onComplete={onComplete}
      />
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
