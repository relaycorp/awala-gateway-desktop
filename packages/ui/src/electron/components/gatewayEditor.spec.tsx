import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import GatewayEditor from './gatewayEditor';

describe('GatewayEditor', () => {
  test('edits the gateway', async () => {
    const onMigrate = jest.fn();
    render(<GatewayEditor gateway="my.gateway.com" onMigrate={onMigrate} gatewayError={false} />);
    expect(screen.getByText('Public gateway')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a.relaycorp.net' } });
    expect(screen.getByDisplayValue('a.relaycorp.net')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));

    const migrateButton = screen.getByText('Migrate');
    expect(migrateButton.hasAttribute('disabled')).toBeFalsy();
    fireEvent.click(migrateButton);
    expect(onMigrate).toHaveBeenCalledTimes(1);
  });
  test('migration should be disabled if new address is same as old', async () => {
    const originalAddress = 'my.gateway.com';
    const onMigrate = jest.fn();
    render(<GatewayEditor gateway={originalAddress} onMigrate={onMigrate} gatewayError={false} />);
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: originalAddress } });
    const migrateButton = screen.getByText('Migrate');
    expect(migrateButton.hasAttribute('disabled')).toBeTruthy();
    fireEvent.click(migrateButton);
    expect(onMigrate).toHaveBeenCalledTimes(0);
  });
  test('migration should be disabled if consequences checkbox is not ticket', async () => {
    const originalAddress = 'my.gateway.com';
    const onMigrate = jest.fn();
    render(<GatewayEditor gateway={originalAddress} onMigrate={onMigrate} gatewayError={false} />);
    const migrateButton = screen.getByText('Migrate');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: `new-${originalAddress}` } });

    expect(migrateButton.hasAttribute('disabled')).toBeTruthy();
    fireEvent.click(migrateButton);
    expect(onMigrate).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(migrateButton.hasAttribute('disabled')).toBeFalsy();
    fireEvent.click(migrateButton);
    expect(onMigrate).toHaveBeenCalledTimes(1);
  });
  test('rejects an invalid domain name', async () => {
    const onMigrate = jest.fn();
    render(<GatewayEditor gateway="my.gateway.com" onMigrate={onMigrate} gatewayError={false} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'badGateway' } });
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByText('Migrate'));
    expect(onMigrate).toHaveBeenCalledTimes(0);
  });
  test('displays an error on failed migration', async () => {
    const onMigrate = jest.fn();
    render(<GatewayEditor gateway="my.gateway.com" onMigrate={onMigrate} gatewayError={true} />);
    expect(
      screen.getByText('Could not resolve public gateway address.', { exact: false }),
    ).toBeInTheDocument();
  });
});
