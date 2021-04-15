import { Paths } from 'env-paths';
import { Token } from 'typedi';

import { ConfigKey } from './Config';

// TODO: Move to an enum
export const PUBLIC_GATEWAY_ADDRESS = new ConfigKey('public_gateway_address');

export const APP_DIRS = new Token<Paths>('APP_DIRS');
