import React, { Component } from 'react';
import { ConnectionStatus, pollConnectionStatus } from '../../ipc/connectionStatus';

interface Props {
  readonly onSynchronize: () => void
}
interface State {
  readonly status: ConnectionStatus
}

class Home extends Component<Props, State> {
  private mutableIsMounted: boolean = false;

  constructor(props: Props) {
    super(props);
    this.state = { status: ConnectionStatus.DISCONNECTED_FROM_ALL };
  }

  public async componentDidMount() : Promise<void> {
    this.mutableIsMounted = true;
    for await (const item of pollConnectionStatus()) {
      if (this.mutableIsMounted) {
        this.setState({status: item});
      }
    }
  }

  public componentWillUnmount() : void {
    this.mutableIsMounted = false;
  }

  public render() : JSX.Element {
    const { status } = this.state;
    switch (status) {
      case ConnectionStatus.CONNECTED_TO_PUBLIC_GATEWAY:
        return <h1>connected to public gateway</h1>;
      case ConnectionStatus.CONNECTED_TO_COURIER:
      return (
        <div>
          <h1>connected to courier</h1>
          <button onClick={this.props.onSynchronize}>Synchronize</button>
        </div>
      );
      default:
        return <h1>disconnected</h1>;
    }
  }
}

export default Home;
