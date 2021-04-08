import React, { Component } from 'react';
import { getPublicGatewayAddress, migratePublicGatewayAddress , SettingError } from '../../ipc/settings';
import Gateway from './gateway';
import GatewayEditor from './gatewayEditor';

enum Status {
  DISPLAY,
  EDIT,
  DONE
}

interface Props {
  readonly onComplete: () => void
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
      gateway: 'example.relaycorp.cloud',
      gatewayError: false,
      status: Status.DISPLAY,
    }
  }

  public async componentDidMount() : Promise<void> {
    const gateway = await getPublicGatewayAddress();
    this.setState({ gateway });
  }

  public render() : JSX.Element {
    switch(this.state.status) {
      case Status.DONE:
      return (
        <div className='settings'>
          <h1>gateway changed</h1>
          <button onClick={this.props.onComplete}>Close</button>
        </div>
      );
      case Status.EDIT:
      return (
        <div className='settings'>
          <button onClick={this.props.onComplete}>Return to home</button>
          <GatewayEditor
            gateway={ this.state.gateway }
            onMigrate={ this.onMigrate.bind(this) }
            gatewayError={ this.state.gatewayError }
          />
        </div>
      );
      case Status.DISPLAY:
      default:
      return (
        <div className='settings'>
          <Gateway
            gateway={ this.state.gateway }
            onEdit={ this.editGateway.bind(this) }
          />
        </div>
      );
    }
  }

  private onMigrate(newAddress: string) : void {
    this.migrateGateway(newAddress);
  }

  private async migrateGateway(newAddress : string) : Promise<void> {
    try {
      await migratePublicGatewayAddress(newAddress);
      this.setState({status: Status.DONE});
    } catch (error) {
      if (error instanceof SettingError) {
        this.setState({status: Status.EDIT, gatewayError: true});
      }
    }
  }

  private editGateway() : void {
    this.setState({status: Status.EDIT});
  }
}

export default Settings;
