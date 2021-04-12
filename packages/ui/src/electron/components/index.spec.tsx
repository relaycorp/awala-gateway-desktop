import { fireEvent, render, screen } from "@testing-library/react";
import React from 'react';
import Index from './index';

describe('Index', () => {
  test('renders', async () => {
    const el = render(<Index />);
    expect(el.container.firstChild).toBeTruthy();

    expect(screen.getByText("Welcome to Awala")).toBeInTheDocument();
    // Exit onboarding
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Get Started"));
    expect(screen.getByText("You're disconnected from Awala")).toBeInTheDocument();
  });
});
