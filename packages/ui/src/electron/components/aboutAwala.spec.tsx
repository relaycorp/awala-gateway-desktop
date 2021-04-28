import { fireEvent, render, screen } from "@testing-library/react";
import React from 'react';
import AboutAwala from './aboutAwala';
import { shell } from 'electron';

describe('AboutAwala', () => {
  test('renders', async () => {
    render(<AboutAwala />);
    expect(screen.getByText("Version", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("By Relaycorp", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Learn more about Awala'));
    fireEvent.click(screen.getByText('Legal policies'));
    expect(shell.openExternal).toHaveBeenCalledTimes(2);
  });
});
