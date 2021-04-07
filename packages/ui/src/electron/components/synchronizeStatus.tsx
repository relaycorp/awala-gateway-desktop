import React, { Component } from 'react';
import { CourierSyncStatus } from '../../ipc/courierSync';
import syncingDone from '../assets/syncingDone.svg';
import syncingError from '../assets/syncingError.svg';
import SyncContent from './syncContent';

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
      return (
        <SyncContent image={syncingError} title="Something went wrong"
          text="You may try again. ">
          <button onClick={this.props.onComplete}> Close </button>
          <button className="yellow" > Try Again </button>
        </SyncContent>
      );
    }
    switch (this.props.status) {
      case CourierSyncStatus.COLLECTING_CARGO:
        return (
          <SyncContent text="Collecting data...">
            <button onClick={this.props.onComplete}> Stop </button>
          </SyncContent>
        );
      case CourierSyncStatus.DELIVERING_CARGO:
        return (
          <SyncContent text="Delivering data...">
            <button onClick={this.props.onComplete}> Stop </button>
          </SyncContent>
        );
      case CourierSyncStatus.COMPLETE:
        return (
          <SyncContent image={syncingDone} text="Done!">
            <button onClick={this.props.onComplete}> Close </button>
          </SyncContent>
        );
      case CourierSyncStatus.WAITING:
      default:
        return (
          <SyncContent text="Waiting for the incoming data to become available ...">
            <button onClick={this.props.onComplete}> Stop </button>
          </SyncContent>
        );
    }
  }
}

export default SynchronizeStatus;
