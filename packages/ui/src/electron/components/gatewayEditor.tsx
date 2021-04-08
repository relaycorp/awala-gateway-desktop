import React, { ChangeEvent, Component } from 'react';

interface Props {
  readonly gateway: string;
  readonly onMigrate: (newAddress: string) => void
  readonly gatewayError: boolean
}
interface State {
  readonly newGateway: string
}
class GatewayEditor extends Component<Props, State> {
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
        <label htmlFor='gateway'>Enter the new address</label>
        <input name='gateway' type='text' placeholder='New Public Gateway'
          onChange={this.onChange.bind(this)} />
        { this.errorMessage() }
        <button className='yellow' onClick={this.submit.bind(this)}>
          Migrate
        </button>
      </div>
    );
  }

  private errorMessage() : JSX.Element | null {
    if (this.props.gatewayError) {
      return (
        <p className='error'>
          Could not resolve  public gateway address. Please confirm it is correct.
        </p>
      );
    }
    return null;
  }

  private onChange(event: ChangeEvent<HTMLInputElement>) {
    this.setState({newGateway: event.target.value});
  }

  private submit() {
    this.props.onMigrate(this.state.newGateway);
  }
}

export default GatewayEditor;
