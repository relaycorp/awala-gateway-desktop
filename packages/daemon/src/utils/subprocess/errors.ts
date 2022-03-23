// tslint:disable:max-classes-per-file

import { PrivateGatewayError } from '../../errors';

export class SubprocessError extends PrivateGatewayError {}

export class SubprocessExitError extends SubprocessError {
  constructor(message: string, public readonly exitCode: number) {
    super(message);
  }
}
