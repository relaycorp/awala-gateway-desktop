import React, { Component } from 'react';
import Stepper from './stepper';

enum OnboardingStep {
  WELCOME = 0,
  EASY = 1,
  START = 2,
  NUM_STEPS = 3
}

interface Props {
  readonly onComplete: () => void
}

interface State {
}

class Onboarding extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
    };
  }
  public render() : JSX.Element {
    return (
      <Stepper numSteps={OnboardingStep.NUM_STEPS}
        getContent={this.getContent} onComplete={this.props.onComplete}
      />
    );
  }
  private getContent(step: number) : JSX.Element {
    switch (step) {
      case OnboardingStep.WELCOME:
        return <h1>Welcome to Awala</h1>;
      case OnboardingStep.EASY:
        return <h1>Using Awala is easy</h1>;
      case OnboardingStep.START:
        return <h1>Awala keeps you safe.</h1>;
      default:
        return <p>Unknown step</p>
    }
  }
}


export default Onboarding;
