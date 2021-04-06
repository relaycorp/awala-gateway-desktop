import React, { Component } from 'react';
import { CourierSyncStatus, synchronizeWithCourier } from '../../ipc/courierSync';

interface Props {
  readonly onComplete: () => void
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
    const {promise, abort} = synchronizeWithCourier();
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
    if (this.state.error) {
      return <h1>Something went wrong</h1>;
    }
    const { status } = this.state;
    switch (status) {
      case CourierSyncStatus.COLLECTING_CARGO:
        return (
          <div>
            <h1>collecting cargo</h1>;
            <button onClick={this.props.onComplete}> Stop </button>
          </div>
        );
      case CourierSyncStatus.DELIVERING_CARGO:
        return <h1>delivering cargo</h1>;
      case CourierSyncStatus.COMPLETE:
        return (
          <div>
            <h1>Done</h1>
            <button onClick={this.props.onComplete}> Home </button>
          </div>
        );
      case CourierSyncStatus.WAITING:
      default:
        return <h1>waiting</h1>;
    }
  }
}

export default Synchronize;
