import VError from 'verror';

export abstract class PrivateGatewayError extends VError {
  get name(): string {
    return this.constructor.name;
  }
}
