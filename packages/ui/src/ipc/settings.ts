import PrivateGatewayError from '../PrivateGatewayError';

export class SettingError extends PrivateGatewayError {}

/**
 * Get the Internet address of the Internet gateway we're currently paired to.
 */
export async function getInternetGatewayAddress(token: string): Promise<string> {
  const response = await fetch('http://127.0.0.1:13276/_control/public-gateway', {
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json; charset=UTF-8',
    },
  });
  const json = await response.json();
  if (response.status === 200) {
    return json.internetAddress;
  } else {
    throw new SettingError(json.message || response.statusText);
  }
}

/**
 * Migrate to a new Internet gateway.
 *
 * @param newAddress
 * @param token
 * @throws SettingError if the migration fails
 *
 * This function will simply resolve when the migration completes successfully.
 */
export async function migrateInternetGatewayAddress(
  newAddress: string,
  token: string,
): Promise<void> {
  const response = await fetch('http://127.0.0.1:13276/_control/public-gateway', {
    body: JSON.stringify({ internetAddress: newAddress }),
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
