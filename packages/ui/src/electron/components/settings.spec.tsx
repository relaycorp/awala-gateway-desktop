import { fireEvent, render, screen } from "@testing-library/react";
import React from 'react';
import Settings from './settings';

describe('Settings', () => {
  test('edits the gateway', async () => {
    const onComplete = jest.fn();
    render(<Settings onComplete={onComplete} />);
    expect(screen.getByText("Public Gateway")).toBeInTheDocument();
    expect(screen.getByText("Return to home")).toBeInTheDocument();

    // go to the editor
    fireEvent.click(screen.getByText("Change Public Gateway", {exact: false}));
    expect(screen.getByText("New Public Gateway")).toBeInTheDocument();
    expect(screen.getByText("Return to home")).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a.relaycorp.net' } })
    expect(screen.getByDisplayValue("a.relaycorp.net")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByText("Migrate"));
    /*

    expect(screen.getByText("migrated", {exact: false})).toBeInTheDocument();
    expect(screen.getByText("a.relaycorp.net")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));

    expect(onComplete).toHaveBeenCalledTimes(1)
     */

  });
  test('closes', async () => {
    const onComplete = jest.fn();
    render(<Settings onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Return to home"));

    expect(onComplete).toHaveBeenCalledTimes(1)
  });
});
