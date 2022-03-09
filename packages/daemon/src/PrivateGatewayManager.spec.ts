import { Container } from 'typedi';

import { PrivateGatewayManager } from './PrivateGatewayManager';
import { setUpTestDBConnection } from './testUtils/db';
import { Config, ConfigKey } from './Config';
import { MissingGatewayError } from './errors';

setUpTestDBConnection();

describe('createCurrentIfMissing', () => {
  test('Node should be created if private address is absent', async () => {
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS)).resolves.toBeNull();
    const gatewayManager = Container.get(PrivateGatewayManager);

    await gatewayManager.createCurrentIfMissing();

    const privateAddress = await config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS);
    expect(privateAddress).toBeTruthy();
    await expect(gatewayManager.get(privateAddress!)).resolves.not.toBeNull();
  });

  test('Node should be created if private key does not', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.CURRENT_PRIVATE_ADDRESS, '0deadbeef');
    const gatewayManager = Container.get(PrivateGatewayManager);

    await gatewayManager.createCurrentIfMissing();

    const privateAddress = await config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS);
    await expect(gatewayManager.get(privateAddress!)).resolves.not.toBeNull();
  });

  test('Node should be reused if it already exists', async () => {
    const gatewayManager = Container.get(PrivateGatewayManager);
    await gatewayManager.createCurrentIfMissing();
    const config = Container.get(Config);
    const originalPrivateAddress = await config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS);

    await gatewayManager.createCurrentIfMissing();

    const newPrivateAddress = await config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS);
    expect(newPrivateAddress).toBeTruthy();
    expect(newPrivateAddress).toEqual(originalPrivateAddress);
  });
});

describe('getCurrent', () => {
  test('Error should be thrown if private address is absent', async () => {
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.CURRENT_PRIVATE_ADDRESS)).resolves.toBeNull();
    const gatewayManager = Container.get(PrivateGatewayManager);

    await expect(gatewayManager.getCurrent()).rejects.toThrowWithMessage(
      MissingGatewayError,
      'Config does not contain current private address',
    );
  });

  test('Error should be thrown if private key is absent', async () => {
    const privateAddress = '0deadbeef';
    await Container.get(Config).set(ConfigKey.CURRENT_PRIVATE_ADDRESS, privateAddress);
    const gatewayManager = Container.get(PrivateGatewayManager);

    await expect(gatewayManager.getCurrent()).rejects.toThrowWithMessage(
      MissingGatewayError,
      `Private key (${privateAddress}) is missing`,
    );
  });

  test('Existing gateway should be returned', async () => {
    const gatewayManager = Container.get(PrivateGatewayManager);
    await gatewayManager.createCurrentIfMissing();

    const gateway = await gatewayManager.getCurrent();

    await expect(Container.get(Config).get(ConfigKey.CURRENT_PRIVATE_ADDRESS)).resolves.toEqual(
      gateway.privateAddress,
    );
  });
});
