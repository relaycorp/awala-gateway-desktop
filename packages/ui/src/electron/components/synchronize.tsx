import React, { Component } from 'react';
import { CourierSyncStatus, synchronizeWithCourier } from '../../ipc/courierSync';

interface Props {
}
interface State {
  readonly status: CourierSyncStatus
}

class Synchronize extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { status: CourierSyncStatus.WAITING };
  }

  public async componentDidMount() : Promise<void> {
    for await (const item of synchronizeWithCourier()) {
      this.setState({status: item});
    }
  }

  public render() : JSX.Element {
    const { status } = this.state;
    switch (status) {
      case CourierSyncStatus.COLLECTING_CARGO:
        return <h1>collecting cargo</h1>;
      case CourierSyncStatus.DELIVERING_CARGO:
        return <h1>connected to courier</h1>;
      default:
        return <h1>waiting</h1>;
    }
  }
}

export default Synchronize;
