import React, { Component } from 'react';
import { ConnectionStatus , pollConnectionStatus } from '../../ipc/connectionStatus';
import Status from './status';

interface Props {
  readonly onSynchronize: () => void
  readonly token: string
}
interface State {
  readonly status: ConnectionStatus
  readonly abort?: () => void
}

class Home extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { status: ConnectionStatus.CONNECTING_TO_INTERNET_GATEWAY };
  }

  public override async componentDidMount(): Promise<void> {
    const { promise, abort } = pollConnectionStatus(this.props.token);
    this.setState({ abort });
    for await (const item of promise) {
      this.setState({ status: item });
    }
  }

  public override componentWillUnmount(): void {
    if (this.state.abort) {
      this.state.abort();
    }
  }

  public override render(): JSX.Element {
    return <Status status={this.state.status} onSynchronize={this.props.onSynchronize} />;
  }
}

export default Home;
