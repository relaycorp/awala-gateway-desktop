import React, { Component } from 'react';
import { getInternetGatewayAddress, migrateInternetGatewayAddress, SettingError } from '../../ipc/settings';
import migrated from '../assets/migrated.svg';
import GatewayEditor from './gatewayEditor';

enum Status {
  EDIT,
  DONE
}

interface Props {
  readonly onComplete: () => void
  readonly token: string
}
interface State {
  readonly status: Status
  readonly gateway: string
  readonly gatewayError: boolean
}

class Settings extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      gateway: '',
      gatewayError: false,
      status: Status.EDIT,
    };
  }

  public override async componentDidMount(): Promise<void> {
    const gateway = await getInternetGatewayAddress(this.props.token);
    this.setState({ gateway });
  }

  public override render(): JSX.Element {
    switch (this.state.status) {
      case Status.DONE:
        return (
          <div className="settings">
            <div className="content">
              <div className="migrated">
                <img src={migrated} />
                <h3>Successfully migrated to</h3>
                <p>{this.state.gateway}</p>
                <button onClick={this.props.onComplete}>Close</button>
              </div>
            </div>
          </div>
        );
      case Status.EDIT:
      default:
        return (
          <div className="settings">
            <button className="back" onClick={this.props.onComplete}>
              Return to home
            </button>
            <div className="content">
              <GatewayEditor
                gateway={this.state.gateway}
                onMigrate={this.onMigrate.bind(this)}
                gatewayError={this.state.gatewayError}
              />
            </div>
          </div>
        );
    }
  }

  private onMigrate(newAddress: string): void {
    this.migrateGateway(newAddress);
  }

  private async migrateGateway(newAddress: string): Promise<void> {
    try {
      await migrateInternetGatewayAddress(newAddress, this.props.token);
      this.setState({ status: Status.DONE, gateway: newAddress });
    } catch (error) {
      if (error instanceof SettingError) {
        this.setState({ status: Status.EDIT, gatewayError: true });
      }
    }
  }
}

export default Settings;
