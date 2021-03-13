import React, { Component } from 'react';
import { ConnectionStatus, pollConnectionStatus } from '../../ipc/connectionStatus';

interface Props {
}
interface State {
  readonly status: ConnectionStatus
}

class Home extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { status: ConnectionStatus.DISCONNECTED_FROM_ALL };
  }

  public async componentDidMount() : Promise<void> {
    for await (const item of pollConnectionStatus()) {
      this.setState({status: item});
    }
  }

  public render() : JSX.Element {
    const { status } = this.state;
    switch (status) {
      case ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY:
        return <h1>connected to public gateway</h1>;
      case ConnectionStatus.CONNECTED_TO_COURIER:
        return <h1>connected to courier</h1>;
      default:
        return <h1>disconnected</h1>;
    }
  }
}

export default Home;
