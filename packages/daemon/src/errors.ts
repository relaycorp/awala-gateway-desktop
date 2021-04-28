// tslint:disable:max-classes-per-file

import VError from 'verror';

export abstract class PrivateGatewayError extends VError {
  get name(): string {
    return this.constructor.name;
  }
}

export class UnregisteredGatewayError extends PrivateGatewayError {}
