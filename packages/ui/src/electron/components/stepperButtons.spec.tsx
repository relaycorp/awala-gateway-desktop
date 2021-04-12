import { fireEvent, render, screen } from "@testing-library/react";
import React from 'react';
import StepperButtons from './stepperButtons';

describe('StepperButtons', () => {
  test('displays only the next button on the first screen', async () => {
    let nextClicked : boolean = false;
    function nextStep() : void {
      nextClicked = true;
    }
    function prevStep() : void { return; }
    function onComplete() : void { return; }
    render(
      <StepperButtons numSteps={3} selected={0} nextStep={nextStep} prevStep={prevStep}
        onComplete={onComplete}/>
    );

    // First screen
    expect(screen.getByText("Next")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));
    expect(nextClicked).toBeTruthy();
  })
  test('displays next and back buttons on the second screen', async () => {
    let nextClicked : boolean = false;
    let prevClicked : boolean = false;
    function nextStep() : void {
      nextClicked = true;
    }
    function prevStep() : void {
      prevClicked = true;
    }
    function onComplete() : void { return; }
    render(
      <StepperButtons numSteps={3} selected={1} nextStep={nextStep} prevStep={prevStep}
        onComplete={onComplete}/>
    );

    // Middle screen
    expect(screen.getByText("Next")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));
    expect(nextClicked).toBeTruthy();

    expect(screen.getByText("Back")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Back"));
    expect(prevClicked).toBeTruthy();
  })
  test('displays back and complete buttons on the second screen', async () => {
    let prevClicked : boolean = false;
    let complete : boolean = false;
    function nextStep() : void { return; }
    function prevStep() : void {
      prevClicked = true;
    }
    function onComplete() : void {
      complete = true;
    }
    render(
      <StepperButtons numSteps={3} selected={2} nextStep={nextStep} prevStep={prevStep}
        onComplete={onComplete}/>
    );

    expect(screen.getByText("Back")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Back"));
    expect(prevClicked).toBeTruthy();

    expect(screen.getByText("Get Started")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Get Started"));
    expect(complete).toEqual(true);
  });
});
