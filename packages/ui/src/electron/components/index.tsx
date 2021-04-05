import React, { Component } from 'react';
import Home from './home';
import Onboarding from './onboarding';

enum ModalState {
  MODAL_NONE,
  MODAL_ABOUT,
  MODAL_LIBRARIES,
  MODAL_SETTINGS
}

interface Props {
}

interface State {
  readonly modal: ModalState,
  readonly onboarded: boolean,
  readonly synchronize: boolean
}

class Index extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      modal: ModalState.MODAL_NONE,
      onboarded: typeof localStorage.getItem('onboarded') === 'string',
      synchronize: false
    };
  }
  public render() : JSX.Element {
    if (!this.state.onboarded) {
      return <Onboarding onComplete={this.onOnboardingComplete.bind(this)} />;
    }
    return (
      <Home onSynchronize={this.onSynchronize.bind(this)}/>
    );
  }
  private onOnboardingComplete() : void {
    localStorage.setItem('onboarded', 'onboarded');
    this.setState({'onboarded': true});
  }
  private onSynchronize() : void {
    this.setState({'synchronize': true});
  }
}

export default Index;
