import { fireEvent, render, screen } from "@testing-library/react";
import React from 'react';
import Stepper from './stepper';

describe('Stepper', () => {
  test('steps through the screens', async () => {
    let complete : boolean = false;
    function onComplete() : void {
      complete = true;
    }
    function getContent(step: number) : JSX.Element {
      return <p>Step {step + 1}</p>;
    }
    function getImage(step: number) : string {
      return 'url' + step;
    }
    render(<Stepper numSteps={3} onComplete={onComplete} getContent={getContent} getImage={getImage} />);

    // First screen
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();

    // Second screen
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 2")).toBeInTheDocument();

    // Back to the first screen again!
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Step 1")).toBeInTheDocument();

    // On to the third and final screen
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 3")).toBeInTheDocument();

    // And finished
    fireEvent.click(screen.getByText("Get Started"));
    expect(complete).toEqual(true);
  });
});
