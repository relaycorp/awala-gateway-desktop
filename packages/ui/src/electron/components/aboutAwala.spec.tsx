import { render, screen } from "@testing-library/react";
import React from 'react';
import AboutAwala from './aboutAwala';

describe('AboutAwala', () => {
  test('renders', async () => {
    render(<AboutAwala />);
    expect(screen.getByText("Version", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("By Relaycorp", { exact: false })).toBeInTheDocument();
  });
});
