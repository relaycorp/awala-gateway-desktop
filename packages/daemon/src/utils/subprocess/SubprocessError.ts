import { PrivateGatewayError } from '../../errors';

export class SubprocessError extends PrivateGatewayError {
  constructor(message: string, public readonly exitCode?: number) {
    super(message);
  }
}
