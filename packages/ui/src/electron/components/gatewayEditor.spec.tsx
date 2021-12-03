import { fireEvent, render, screen } from "@testing-library/react";
import React from 'react';
import GatewayEditor from './gatewayEditor';

describe('GatewayEditor', () => {
  test('edits the gateway', async () => {
    const onMigrate = jest.fn();
    render(<GatewayEditor gateway="my.gateway.com" onMigrate={onMigrate} gatewayError={false}/>);
    expect(screen.getByText("Public gateway")).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a.relaycorp.net' } })
    expect(screen.getByDisplayValue("a.relaycorp.net")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByText("Migrate"));
    expect(onMigrate).toHaveBeenCalledTimes(1)
  });
  test('rejects an invalid domain name', async () => {
    const onMigrate = jest.fn();
    render(<GatewayEditor gateway="my.gateway.com" onMigrate={onMigrate} gatewayError={false}/>);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'badGateway' } });
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByText("Migrate"));
    expect(onMigrate).toHaveBeenCalledTimes(0)
  });
  test('requires checkbox click', async () => {
    const onMigrate = jest.fn();
    render(<GatewayEditor gateway="my.gateway.com" onMigrate={onMigrate} gatewayError={false}/>);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a.relaycorp.net' } })

    fireEvent.click(screen.getByText("Migrate"));
    expect(onMigrate).toHaveBeenCalledTimes(0)
  });
  test('displays an error on failed migration', async () => {
    const onMigrate = jest.fn();
    render(<GatewayEditor gateway="my.gateway.com" onMigrate={onMigrate} gatewayError={true}/>);
    expect(screen.getByText("Could not resolve public gateway address.", {exact: false})).toBeInTheDocument();

  });
});
