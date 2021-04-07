import React, { Component } from 'react';
import { ConnectionStatus } from '../../ipc/connectionStatus';
import connected from '../assets/connected.svg';
import courier from '../assets/courier.svg';
import disconnected from '../assets/disconnected.svg';
import HomeContent from './homeContent';

interface Props {
  readonly onSynchronize?: () => void,
  readonly status: ConnectionStatus
}

class Status extends Component<Props> {
  constructor(props: Props) {
    super(props);
  }

  public render() : JSX.Element {
    switch (this.props.status) {
      case ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY:
        return (
          <HomeContent title="connected to Awala" image={connected} >
            <p>foooo</p>
          </HomeContent>
        );
      case ConnectionStatus.CONNECTED_TO_COURIER:
        return (
          <HomeContent title="connected to courier" image={courier} >
            <button onClick={this.props.onSynchronize}>Synchronize</button>
          </HomeContent>
        );
      default:
        return (
          <HomeContent title="disconnected" image={disconnected} >
            <p>baaaz</p>
          </HomeContent>
        );
    }
  }
}

export default Status;
