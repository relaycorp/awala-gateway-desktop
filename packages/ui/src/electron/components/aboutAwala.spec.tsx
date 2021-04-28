import { fireEvent, render, screen } from "@testing-library/react";
import { shell } from 'electron';
import React from 'react';
import AboutAwala from './aboutAwala';

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
