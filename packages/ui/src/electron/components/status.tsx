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
          <HomeContent title="You are connected to Awala via the Internet"
            image={connected} >
            <p>
              So there’s no much to do here. Feel free to close this app and
              enjoy your Awala apps.
            </p>
            <p>
              Come back if you’re cut off from the Internet.
            </p>
          </HomeContent>
        );
      case ConnectionStatus.CONNECTED_TO_COURIER:
        return (
          <HomeContent title="You're connected to a courier" image={courier} >
            <p>
              So you’re good to go!
            </p>
            <p>
              <b>Remember</b>: Your data is safe while it isn’t in transit
              and if it gets lost we’ll try to deliver it again.
            </p>
            <button onClick={this.props.onSynchronize}>Start sync</button>
          </HomeContent>
        );
      default:
        return (
          <HomeContent title="You're disconnected from Awala" image={disconnected}
            className='disconnected'>
            <p>
              You can still send and receive data from the Internet via Awala
              couriers: Simply connect to a nearby courier and we'll do the rest.
            </p>
            <p>
              If there is a courier near you, connect to their Wi-fi network to
              sync the data. You will have to:
            </p>
            <ol>
              <li>Turn on your Wi-Fi if it’s off.</li>
              <li>Connect to the courier’s network.</li>
              <li>Wait until their device is ready.</li>
            </ol>
          </HomeContent>
        );
    }
  }
}

export default Status;
