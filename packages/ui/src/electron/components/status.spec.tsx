import { render, screen } from "@testing-library/react";
import React from 'react';
import { ConnectionStatus } from '../../ipc/connectionStatus';
import Status from './status';

describe('Status', () => {
  test('renders disconnected', async () => {
    render(<Status status={ConnectionStatus.DISCONNECTED_FROM_ALL}/>);
    expect(screen.getByText("disconnected")).toBeInTheDocument();
  });
  test('renders connected to courier', async () => {
    render(<Status status={ConnectionStatus.CONNECTED_TO_COURIER} />);
    expect(screen.getByText("connected to courier")).toBeInTheDocument();
  });
  test('renders connected to awala', async () => {
    render(<Status status={ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY}/>);
    expect(screen.getByText("connected to Awala")).toBeInTheDocument();
  });
});
