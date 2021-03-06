import PrivateGatewayError from '../PrivateGatewayError';

export class SettingError extends PrivateGatewayError {}

/**
 * Get the public address of the public gateway we're currently paired to.
 */
export function getPublicGatewayAddress(): Promise<string> {
  return Promise.resolve('braavos.relaycorp.cloud');
}

/**
 * Migrate to a new public gateway.
 *
 * @param _newAddress
 * @throws SettingError if the migration fails
 *
 * This function will simply resolve when the migration completes successfully.
 */
export function migratePublicGatewayAddress(_newAddress: string): Promise<void> {
  return Promise.resolve();
}
