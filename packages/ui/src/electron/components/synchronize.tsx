import React, { Component } from 'react';
import { CourierSyncStatus, synchronizeWithCourier } from '../../ipc/courierSync';
import SynchronizeStatus from './synchronizeStatus';

interface Props {
  readonly onComplete: () => void
  readonly onReset: () => void
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

  public override async componentDidMount() : Promise<void> {
    try {
      const {promise, abort} = synchronizeWithCourier(this.props.token);
      this.setState({ abort });

      for await (const item of promise) {
        this.setState({status: item});
      }
    } catch (error) {
      this.setState({error: true});
    }
  }

  public override componentWillUnmount() : void {
    if (this.state.abort) {
      this.state.abort();
    }
  }

  public override render() : JSX.Element {
    return (
      <SynchronizeStatus
        status={this.state.status}
        error={this.state.error}
        onComplete={this.props.onComplete}
        onReset={this.props.onReset} />
    );
  }
}

export default Synchronize;
