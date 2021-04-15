import { Paths } from 'env-paths';
import { Logger } from 'pino';
import { Token } from 'typedi';

import { ConfigKey } from './Config';

// TODO: Move to an enum
export const PUBLIC_GATEWAY_ADDRESS = new ConfigKey('public_gateway_address');

export const APP_DIRS = new Token<Paths>('APP_DIRS');
export const LOGGER = new Token<Logger>('LOGGER');
