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

class Onboarding extends Component<Props> {
  constructor(props: Props) {
    super(props);
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
      return (
        <div>
          <h1>Welcome to Awala</h1>
          <p>
            Awala enables compatible apps on your device to send and receive data
            from the Internet securely, even when you’re disconnected from the
            Internet.
          </p>
        </div>
      );
      case OnboardingStep.EASY:
      return (
        <div>
          <h1>Using Awala is easy</h1>
          <p>
            When you’re connected to the Internet, your apps will simply use
            it seamlessly.
          </p>
          <p>
            When you’re cut off from the Internet, Awala couriers will
            transport your apps’ data to and from the Internet.
          </p>
        </div>
      );
      case OnboardingStep.START:
      return (
        <div>
        <h1>Awala keeps you safe</h1>
          <p>
            Awala apps use end-to-end encryption, so it’s impossible for this
            app or couriers to see their data.
          </p>
          <p>
            It’s also impossible for couriers to find out which apps you’re
            using. And needless to say we aren’t tracking you or your apps!
          </p>
        </div>
      );
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
