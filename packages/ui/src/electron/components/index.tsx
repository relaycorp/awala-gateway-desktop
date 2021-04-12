import { ipcRenderer } from 'electron';
import React, { Component } from 'react';
import '../styles.css'
import Home from './home';
import Onboarding from './onboarding';
import Settings from './settings';
import Synchronize from './synchronize';

enum Status {
  HOME,
  ONBOARDING,
  SYNCHRONIZE,
  SETTINGS
}

interface Props {
}

interface State {
  readonly status: Status
}

class Index extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const onboarded = typeof localStorage.getItem('onboarded') === 'string';
    this.state = {
      status: !onboarded ? Status.ONBOARDING : Status.HOME
    };
    ipcRenderer.on('show-public-gateway', this.showSettings.bind(this));
  }
  public render() : JSX.Element {
    switch(this.state.status) {
      case Status.ONBOARDING:
        return <Onboarding onComplete={this.onOnboardingComplete.bind(this)} />;
      case Status.SYNCHRONIZE:
        return <Synchronize onComplete={this.returnToHome.bind(this)} />;
      case Status.SETTINGS:
        return <Settings onComplete={this.returnToHome.bind(this)} />;
      case Status.HOME:
      default:
        return <Home onSynchronize={this.onSynchronize.bind(this)}/>;
    }
  }
  private onOnboardingComplete() : void {
    localStorage.setItem('onboarded', 'onboarded');
    this.setState({'status': Status.HOME});
  }
  private onSynchronize() : void {
    this.setState({'status': Status.SYNCHRONIZE});
  }
  private returnToHome() : void {
    this.setState({'status': Status.HOME});
  }
  private showSettings() : void {
    this.setState({'status': Status.SETTINGS});
  }
}

export default Index;
