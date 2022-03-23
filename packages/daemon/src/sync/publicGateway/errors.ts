// tslint:disable:max-classes-per-file

import { PrivateGatewayError } from '../../errors';

export class NonExistingAddressError extends PrivateGatewayError {}

/**
 * Error representing a protocol violation by the public gateway.
 */
export class PublicGatewayProtocolError extends PrivateGatewayError {}
