// tslint:disable:max-classes-per-file

import VError from 'verror';

export class PrivateGatewayError extends VError {}

export class ConfigError extends PrivateGatewayError {}
