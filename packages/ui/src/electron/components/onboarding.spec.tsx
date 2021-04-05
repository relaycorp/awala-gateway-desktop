import { fireEvent, render, screen } from "@testing-library/react";
import React from 'react';
import Onboarding from './onboarding';

describe('Onboarding', () => {
  test('steps through the screens', async () => {
    let complete : boolean = false;
    function onComplete() : void {
      complete = true;
    }
    render(<Onboarding onComplete={onComplete} />);

    // First screen
    expect(screen.getByText("Welcome to Awala")).toBeInTheDocument();

    // Second screen
    fireEvent.click(screen.getByText("Next"));

    // Back to the first screen again!
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Welcome to Awala")).toBeInTheDocument();

    // On to the third and final screen
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));

    // And finished
    fireEvent.click(screen.getByText("Get Started"));
    expect(complete).toEqual(true);
  });
});
