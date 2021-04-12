import React, { Component } from 'react';
import { CourierSyncStatus, synchronizeWithCourier } from '../../ipc/courierSync';
import SynchronizeStatus from './synchronizeStatus';

interface Props {
  readonly onComplete: () => void
  readonly token: string
}
interface State {
  readonly status: CourierSyncStatus,
  readonly error: boolean,
  readonly abort?: () => void
}

class Synchronize extends Component<Props, State> {

  constructor(props: Props) {
    super(props);
    this.state = {
      error: false,
      status: CourierSyncStatus.WAITING,
    };
  }

  public async componentDidMount() : Promise<void> {
    const {promise, abort} = synchronizeWithCourier(this.props.token);
    this.setState({ abort });
    try {
      for await (const item of promise) {
        this.setState({status: item});
      }
    } catch (error) {
      this.setState({error: true});
    }
  }

  public componentWillUnmount() : void {
    if (this.state.abort) {
      this.state.abort();
    }
  }

  public render() : JSX.Element {
    return (
      <SynchronizeStatus
        status={this.state.status}
        error={this.state.error}
        onComplete={this.props.onComplete} />
    );
  }
}

export default Synchronize;
