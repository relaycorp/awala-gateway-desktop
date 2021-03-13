import React, { Component } from 'react';

interface Props {
  readonly nextStep: () => void,
  readonly numSteps: number,
  readonly onComplete: () => void,
  readonly prevStep: () => void,
  readonly selected: number
}

interface ButtonProps {
  readonly onClick: () => void,
  readonly text: string
}

function Button(props: ButtonProps) : JSX.Element {
  return <button onClick={props.onClick}>{props.text}</button>;
}

class StepperButtons extends Component<Props> {
  constructor(props: Props) {
    super(props);
    this.state = { step: 0 };
  }
  public render() : JSX.Element {
    return <div>{ this.buttons() }</div>;
  }
  private backButton() : JSX.Element {
    return <Button key="back" onClick={this.props.prevStep} text="Back" />;
  }
  private nextButton() : JSX.Element {
    return <Button key="next" onClick={this.props.nextStep} text="Next" />;
  }
  private completeButton() : JSX.Element {
    return <Button key="complete" onClick={this.props.onComplete} text="Get Started" />;
  }
  private buttons() : readonly JSX.Element[] {
    if (this.props.selected === 0) {
      // first step
      return [ this.nextButton() ];
    }
    if (this.props.selected === this.props.numSteps - 1) {
      // last step
      return [ this.backButton(), this.completeButton() ];
    }

    // middle steps
    return [ this.backButton(), this.nextButton() ];

  }
}

export default StepperButtons;
