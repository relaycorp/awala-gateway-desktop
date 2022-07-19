import React, { Component } from 'react';
import StepperButtons from './stepperButtons';
import StepperDots from './stepperDots';

interface Props {
  readonly getContent: (step: number) => JSX.Element,
  readonly getImage: (step: number) => string,
  readonly onComplete: () => void,
  readonly numSteps: number
}

interface State {
  readonly step: number
}

class Stepper extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { step: 0 };
  }
  public override render(): JSX.Element {
    return (
      <div className="stepper">
        <div className="left">
          <img src={this.props.getImage(this.state.step)} />
        </div>
        <div className="right">
          <div className="content">{this.props.getContent(this.state.step)}</div>
          <StepperButtons
            numSteps={this.props.numSteps}
            selected={this.state.step}
            prevStep={this.prevStep.bind(this)}
            nextStep={this.nextStep.bind(this)}
            onComplete={this.props.onComplete}
          />
          <StepperDots count={this.props.numSteps} selected={this.state.step} />
        </div>
      </div>
    );
  }
  private prevStep(): void {
    if (this.state.step > 0) {
      this.setState({ step: this.state.step - 1 });
    }
  }
  private nextStep(): void {
    if (this.state.step < this.props.numSteps) {
      this.setState({ step: this.state.step + 1 });
    }
  }
}

export default Stepper;
