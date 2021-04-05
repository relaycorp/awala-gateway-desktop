import React, { Component } from 'react';
import { CourierSyncStatus, synchronizeWithCourier } from '../../ipc/courierSync';

interface Props {
  readonly onComplete: () => void
}
interface State {
  readonly status: CourierSyncStatus,
  readonly complete: boolean,
  readonly error: boolean,
}

class Synchronize extends Component<Props, State> {
  private mutableIsMounted: boolean = false;

  constructor(props: Props) {
    super(props);
    this.state = {
      complete: false,
      error: false,
      status: CourierSyncStatus.WAITING,
    };
  }

  public async componentDidMount() : Promise<void> {
    this.mutableIsMounted = true;
    try {
      for await (const item of synchronizeWithCourier()) {
        if (this.mutableIsMounted) {
          this.setState({status: item});
        }
      }
      if (this.mutableIsMounted) {
        this.setState({complete: true});
      }
    } catch (error) {
      if (this.mutableIsMounted) {
        this.setState({error: true});
      }
    }
  }

  public componentWillUnmount() : void {
    this.mutableIsMounted = false;
  }

  public render() : JSX.Element {
    if (this.state.error) {
      return <h1>Something went wrong</h1>;
    }
    if (this.state.complete) {
      return (
        <div>
          <h1>Done</h1>
          <button onClick={this.props.onComplete}> Home </button>
        </div>
      );
    }
    const { status } = this.state;
    switch (status) {
      case CourierSyncStatus.COLLECTING_CARGO:
        return <h1>collecting cargo</h1>;
      case CourierSyncStatus.DELIVERING_CARGO:
        return <h1>delivering cargo</h1>;
      case CourierSyncStatus.WAITING:
      default:
        return <h1>waiting</h1>;
    }
  }
}

export default Synchronize;
