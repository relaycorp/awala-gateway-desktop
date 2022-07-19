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
      valid: false,
    };
  }

  public override render(): JSX.Element {
    const gatewayAddress =
      this.state.newGateway.length === 0 ? this.props.gateway : this.state.newGateway;
    const canMigrate = this.state.valid && this.state.confirmed;
    return (
      <div className="gatewayEditor">
        <h3>Public gateway</h3>
        <p>
          Your computer needs to be paired to an <em>Awala public gateway</em> on the Internet, and
          by default it will use one run by Relaycorp.
        </p>
        <p>
          <strong>You should not migrate to another gateway</strong>, unless you’re an advanced user
          who understands the consequences:
        </p>
        <ul>
          <li>Your Awala-compatible apps will be losing incoming data for a while.</li>
          <li>
            Gateways ending with “.relaycorp.cloud” are provided by Relaycorp, and we don’t spy or
            censor our users. If you switch to another provider, make sure they don’t either.
          </li>
        </ul>
        <h4>Public gateway address</h4>
        <input
          name="gateway"
          type="text"
          value={gatewayAddress}
          onChange={this.onChange.bind(this)}
        />
        <div className="info">{this.infoMessage()}</div>
        <label className="checkbox">
          <input name="confirm" type="checkbox" onChange={this.onCheckbox.bind(this)} />I understand
          the consequences of this change.
        </label>
        <button className="yellow submit" disabled={!canMigrate} onClick={this.submit.bind(this)}>
          Migrate
        </button>
      </div>
    );
  }

  private infoMessage(): JSX.Element | null {
    if (this.props.gatewayError) {
      return (
        <p className="error">
          Could not resolve public gateway address. Please confirm it is correct.
        </p>
      );
    } else if (this.state.valid) {
      return <p className="valid">Address looks valid</p>;
    }
    return null;
  }

  private onCheckbox(event: ChangeEvent<HTMLInputElement>): void {
    this.setState({ confirmed: event.target.checked });
  }

  private onChange(event: ChangeEvent<HTMLInputElement>): void {
    const newAddress = event.target.value;
    this.setState({
      newGateway: newAddress,
      valid: isValidDomain(newAddress) && newAddress !== this.props.gateway,
    });
  }

  private submit(): void {
    if (this.state.confirmed && this.state.valid) {
      this.props.onMigrate(this.state.newGateway);
    }
  }
}

export default GatewayEditor;
