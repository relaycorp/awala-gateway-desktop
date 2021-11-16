import PrivateGatewayError from '../PrivateGatewayError';

// Make fetch() work in the Node.js-based unit tests
// tslint:disable-next-line:no-var-requires
require('isomorphic-fetch');

export class SettingError extends PrivateGatewayError {}

/**
 * Get the public address of the public gateway we're currently paired to.
 */
export async function getPublicGatewayAddress(token: string): Promise<string> {
  const response = await fetch('http://127.0.0.1:13276/_control/public-gateway', {
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json; charset=UTF-8',
    },
  });
  const json = await response.json();
  if (response.status === 200) {
    return json.publicAddress;
  } else {
    throw new SettingError(json.message || response.statusText);
  }
}

/**
 * Migrate to a new public gateway.
 *
 * @param newAddress
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
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    method: 'PUT',
  });
  if (response.status === 204) {
    return;
  } else if (response.status === 400 || response.status === 500) {
    const json = await response.json();
    throw new SettingError(json.code || response.statusText);
  } else {
    throw new SettingError(response.statusText);
  }
}
