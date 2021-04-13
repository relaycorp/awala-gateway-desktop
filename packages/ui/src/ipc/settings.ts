import PrivateGatewayError from '../PrivateGatewayError';

export class SettingError extends PrivateGatewayError {}

/**
 * Get the public address of the public gateway we're currently paired to.
 */
export async function getPublicGatewayAddress(token: string): Promise<string> {
  const response = await fetch('http://127.0.0.1:13276/_control/public-gateway', {
    headers: {
      Authentication: token,
      'Content-Type': 'application/json; charset=UTF-8',
    },
  });
  const json = await response.json();
  if (response.status === 200) {
    return json.publicAddress;
  } else {
    throw new SettingError(json.message || response.status);
  }
}

/**
 * Migrate to a new public gateway.
 *
 * @param _newAddress
 * @throws SettingError if the migration fails
 *
 * This function will simply resolve when the migration completes successfully.
 */
export async function migratePublicGatewayAddress(
  newAddress: string,
  token: string,
): Promise<void> {
  const response = await fetch('http://127.0.0.1:13276/_control/public-gateway', {
    body: JSON.stringify({ publicAddress: newAddress }),
    headers: {
      Authentication: token,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    method: 'PUT',
  });
  const json = await response.json();
  if (response.status === 204) {
    return json.publicAddress;
  } else {
    throw new SettingError(json.message || response.status);
  }
}
