import { UnreachableResolverError } from '@relaycorp/relaynet-core';
import { Container } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../testUtils/db';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { mockSleepSeconds } from '../../testUtils/timing';
import { GatewayRegistrar } from './GatewayRegistrar';
import { NonExistingAddressError } from './errors';
import { mockSpy } from '../../testUtils/jest';
import { PrivateGateway } from '../../PrivateGateway';
import { generatePKIFixture, mockGatewayRegistration } from '../../testUtils/crypto';

setUpTestDBConnection();

useTemporaryAppDirs();

const logs = mockLoggerToken();

let registrar: GatewayRegistrar;
beforeEach(() => {
  registrar = Container.get(GatewayRegistrar);
});

const pkiFixtureRetriever = generatePKIFixture();
const { undoGatewayRegistration } = mockGatewayRegistration(pkiFixtureRetriever);

describe('register', () => {
  beforeEach(undoGatewayRegistration);

  const mockRegisterWithPublicGateway = mockSpy(
    jest.spyOn(PrivateGateway.prototype, 'registerWithPublicGateway'),
  );

  test('Registration should be skipped if already registered with new gateway', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.PUBLIC_GATEWAY_PUBLIC_ADDRESS, DEFAULT_PUBLIC_GATEWAY);

    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    expect(mockRegisterWithPublicGateway).not.toBeCalled();
    expect(logs).toContainEqual(
      partialPinoLog('debug', 'Skipping registration with public gateway'),
    );
  });

  test('Registration should be completed if not already registered with peer', async () => {
    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    expect(mockRegisterWithPublicGateway).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
    expect(logs).toContainEqual(
      partialPinoLog('info', 'Successfully registered with public gateway', {
        publicGatewayPublicAddress: DEFAULT_PUBLIC_GATEWAY,
      }),
    );
  });

  test('Public address of public gateway should be stored in config', async () => {
    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.PUBLIC_GATEWAY_PUBLIC_ADDRESS)).resolves.toEqual(
      DEFAULT_PUBLIC_GATEWAY,
    );
  });

  test('Registration errors should be propagated', async () => {
    const originalError = new Error('oh noes');
    mockRegisterWithPublicGateway.mockRejectedValue(originalError);

    await expect(registrar.register(DEFAULT_PUBLIC_GATEWAY)).rejects.toBe(originalError);
  });
});

describe('waitForRegistration', () => {
  let mockRegister: jest.SpyInstance;
  beforeEach(() => {
    mockRegister = jest.spyOn(registrar, 'register');
  });
  afterEach(() => {
    mockRegister.mockRestore();
  });

  let mockIsRegistered: jest.SpyInstance;
  beforeEach(() => {
    mockIsRegistered = jest.spyOn(registrar, 'isRegistered');
  });
  afterEach(() => {
    mockIsRegistered.mockRestore();
  });

  const sleepSeconds = mockSleepSeconds();

  test('Registration should proceed if unregistered', async () => {
    mockIsRegistered.mockResolvedValueOnce(false);
    mockIsRegistered.mockResolvedValueOnce(true);
    mockRegister.mockResolvedValueOnce(undefined);

    await registrar.waitForRegistration();

    expect(mockRegister).toBeCalledTimes(1);
    expect(mockRegister).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
    expect(sleepSeconds).not.toBeCalled();
  });

  test('Registration should be skipped if already registered', async () => {
    mockIsRegistered.mockResolvedValueOnce(true);
    mockRegister.mockResolvedValueOnce(undefined);

    await registrar.waitForRegistration();

    expect(mockRegister).toBeCalledTimes(0);
    expect(sleepSeconds).not.toBeCalled();
  });

  test('Registration should be reattempted if DNS resolver is unreachable', async () => {
    mockIsRegistered.mockResolvedValueOnce(false);
    mockIsRegistered.mockResolvedValueOnce(false);
    mockIsRegistered.mockResolvedValueOnce(true);
    mockRegister.mockRejectedValueOnce(new UnreachableResolverError());
    mockRegister.mockResolvedValueOnce(undefined);

    await registrar.waitForRegistration();

    expect(mockRegister).toBeCalledTimes(2);
    expect(mockRegister).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
    expect(sleepSeconds).toBeCalledWith(5);
    expect(logs).toContainEqual(
      partialPinoLog(
        'debug',
        'Failed to register with public gateway because DNS resolver is unreachable',
      ),
    );
  });

  test('Registration should be reattempted if DNS resolution failed', async () => {
    mockIsRegistered.mockResolvedValueOnce(false);
    mockIsRegistered.mockResolvedValueOnce(false);
    mockIsRegistered.mockResolvedValueOnce(true);
    mockRegister.mockRejectedValueOnce(new NonExistingAddressError());
    mockRegister.mockResolvedValueOnce(undefined);

    await registrar.waitForRegistration();

    expect(mockRegister).toBeCalledTimes(2);
    expect(mockRegister).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
    expect(sleepSeconds).toBeCalledWith(60);
    expect(logs).toContainEqual(
      partialPinoLog('error', 'Failed to register with public gateway', {
        err: expect.objectContaining({ type: NonExistingAddressError.name }),
      }),
    );
  });

  test('Registration should be reattempted if unexpected error happens', async () => {
    mockIsRegistered.mockResolvedValueOnce(false);
    mockIsRegistered.mockResolvedValueOnce(false);
    mockIsRegistered.mockResolvedValueOnce(true);
    mockRegister.mockRejectedValueOnce(new Error());
    mockRegister.mockResolvedValueOnce(undefined);

    await registrar.waitForRegistration();

    expect(mockRegister).toBeCalledTimes(2);
    expect(mockRegister).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
    expect(sleepSeconds).toBeCalledWith(60);
    expect(logs).toContainEqual(
      partialPinoLog('error', 'Failed to register with public gateway', {
        err: expect.objectContaining({ type: 'Error' }),
      }),
    );
  });
});

describe('isRegistered', () => {
  beforeEach(undoGatewayRegistration);

  test('True should be returned if gateway is registered', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.PUBLIC_GATEWAY_PUBLIC_ADDRESS, DEFAULT_PUBLIC_GATEWAY);

    await expect(registrar.isRegistered()).resolves.toBeTrue();
  });

  test('False should be returned if gateway is unregistered', async () => {
    await expect(registrar.isRegistered()).resolves.toBeFalse();
  });
});
