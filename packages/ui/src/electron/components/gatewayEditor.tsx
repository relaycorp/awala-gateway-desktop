import isValidDomain from 'is-valid-domain';
import React, { ChangeEvent, Component } from 'react';

interface Props {
  readonly gateway: string;
  readonly onMigrate: (newAddress: string) => void
  readonly gatewayError: boolean
}
interface State {
  readonly confirmed: boolean,
  readonly newGateway: string,
  readonly valid: boolean,
}
class GatewayEditor extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      confirmed: false,
      newGateway: '',
      valid: false
    }
  }
  public render() : JSX.Element {
    return (
      <div className='gatewayEditor'>
        <h3>New Public Gateway</h3>
        <p>
          Migrating to a new gateway should only be done by advanced users who
          understand the consequences.
        </p>
        <p>
          At present, changing this gateway will most likely prevent your
          existing Awala apps from receiving dat for a while.
        </p>
        <p>
          Gateways ending with “.relaycorp.cloud” are provide by Relaycorp,
          and we don’t spy or censors our users. If you switch to another
          provider, make sure they don’t either.
        </p>
        <h4>Enter the new address</h4>
        <input name='gateway' type='text' placeholder='New Public Gateway'
          onChange={this.onChange.bind(this)} />
        <div className='info'>
          { this.infoMessage() }
        </div>
        <label className='checkbox'>
          <input name='confirm' type='checkbox' onChange={this.onCheckbox.bind(this)}/>
          I understand the consequences of this change.
        </label>
        <button className='yellow submit' onClick={this.submit.bind(this)}>
          Migrate
        </button>
      </div>
    );
  }

  private infoMessage() : JSX.Element | null {
    if (this.props.gatewayError) {
      return (
        <p className='error'>
          Could not resolve public gateway address. Please confirm it is correct.
        </p>
      );
    } else if (this.state.valid) {
      return (
        <p className='valid'>
          Address looks valid
        </p>
      );
    }
    return null;
  }

  private onCheckbox(event: ChangeEvent<HTMLInputElement>) : void {
    this.setState({confirmed: event.target.checked});
  }

  private onChange(event: ChangeEvent<HTMLInputElement>) : void {
    this.setState({
      newGateway: event.target.value,
      valid: this.validateGateway(event.target.value)
    });
  }

  private validateGateway(newGateway: string) : boolean {
    if (isValidDomain(newGateway)) {
      return true;
    }
    return false;
  }

  private submit() : void {
    if (this.state.confirmed && this.state.valid) {
      this.props.onMigrate(this.state.newGateway);
    }
  }
}

export default GatewayEditor;
