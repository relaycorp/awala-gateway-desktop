import React, { Component } from 'react';
import image1 from '../assets/onboarding1.svg';
import image2 from '../assets/onboarding2.svg';
import image3 from '../assets/onboarding3.svg';
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
      <div className='onboarding'>
        <Stepper
          getContent={this.getContent}
          getImage={this.getImage}
          numSteps={OnboardingStep.NUM_STEPS}
          onComplete={this.props.onComplete}
        />
      </div>
    );
  }
  private getContent(step: number) : JSX.Element {
    switch (step) {
      case OnboardingStep.WELCOME:
        return <h1>Welcome to Awala</h1>;
      case OnboardingStep.EASY:
        return <h1>Using Awala is easy</h1>;
      case OnboardingStep.START:
        return <h1>Awala keeps you safe</h1>;
      default:
        return <p>Unknown step</p>
    }
  }

  private getImage(step: number) : string {
    switch (step) {
      case OnboardingStep.WELCOME:
        return image1;
      case OnboardingStep.EASY:
        return image2;
      case OnboardingStep.START:
        return image3;
      default:
        return 'Unknown step'
    }

  }
}


export default Onboarding;
