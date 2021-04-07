import React, { Component } from 'react';
import { CourierSyncStatus } from '../../ipc/courierSync';

interface Props {
  readonly error: boolean
  readonly onComplete: () => void
  readonly status: CourierSyncStatus
}

class SynchronizeStatus extends Component<Props> {

  constructor(props: Props) {
    super(props);
  }

  public render() : JSX.Element {
    if (this.props.error) {
      return <h1>Something went wrong</h1>;
    }
    switch (this.props.status) {
      case CourierSyncStatus.COLLECTING_CARGO:
        return (
          <div>
            <h1>collecting cargo</h1>
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

export default SynchronizeStatus;
