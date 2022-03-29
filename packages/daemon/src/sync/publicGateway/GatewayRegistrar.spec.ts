import { UnreachableResolverError } from '@relaycorp/relaynet-core';
import { addDays, minutesToSeconds, subDays } from 'date-fns';
import { consume, take } from 'streaming-iterables';
import { Container } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../testUtils/db';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { mockSleepSeconds, mockSleepUntilDate } from '../../testUtils/timing';
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

const mockRegisterWithPublicGateway = mockSpy(
  jest.spyOn(PrivateGateway.prototype, 'registerWithPublicGateway'),
  async () => {
    const privateGatewayCertificate = pkiFixtureRetriever().pdaCertPath.privateGateway;
    return privateGatewayCertificate.expiryDate;
  },
);

describe('register', () => {
  beforeEach(undoGatewayRegistration);

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
    const privateGatewayCertificate = pkiFixtureRetriever().pdaCertPath.privateGateway;
    expect(logs).toContainEqual(
      partialPinoLog('info', 'Successfully registered with public gateway', {
        privateGatewayCertificateExpiryDate: privateGatewayCertificate.expiryDate.toISOString(),
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

describe('continuallyRenewRegistration', () => {
  const sleepUntilDateMock = mockSleepUntilDate();

  test('Renewal should be attempted once certificate has less than 90 days left', async () => {
    const privateGatewayCertificate = pkiFixtureRetriever().pdaCertPath.privateGateway;

    await consume(take(1, registrar.continuallyRenewRegistration()));

    const expectedScheduledDate = subDays(privateGatewayCertificate.expiryDate, 90);
    expect(sleepUntilDateMock).toBeCalledWith(expectedScheduledDate, expect.anything());
    expect(mockRegisterWithPublicGateway).toBeCalled();
    expect(logs).toContainEqual(
      partialPinoLog('info', 'Scheduling registration renewal', {
        nextRenewalDate: expectedScheduledDate.toISOString(),
      }),
    );
  });

  test('Renewals should be repeated indefinitely', async () => {
    const certificate1Date = pkiFixtureRetriever().pdaCertPath.privateGateway.expiryDate;
    const certificate2Date = new Date();
    mockRegisterWithPublicGateway.mockResolvedValueOnce(certificate2Date);

    await consume(take(2, registrar.continuallyRenewRegistration()));

    expect(sleepUntilDateMock).toBeCalledTimes(2);
    expect(sleepUntilDateMock).toHaveBeenNthCalledWith(
      1,
      subDays(certificate1Date, 90),
      expect.anything(),
    );
    expect(sleepUntilDateMock).toHaveBeenNthCalledWith(
      2,
      subDays(certificate2Date, 90),
      expect.anything(),
    );
    expect(mockRegisterWithPublicGateway).toBeCalledTimes(2);
  });

  test('Public gateway migrations should be reflected', async () => {
    // Migrate to a different public gateway before the first renewal
    const publicGateway2PublicAddress = `not-${DEFAULT_PUBLIC_GATEWAY}`;
    sleepUntilDateMock.mockImplementationOnce(async () => {
      await registrar.register(publicGateway2PublicAddress);
    });
    sleepUntilDateMock.mockResolvedValueOnce(undefined);
    const certificate2Date = addDays(new Date(), 3);
    mockRegisterWithPublicGateway.mockResolvedValueOnce(certificate2Date);

    await consume(take(1, registrar.continuallyRenewRegistration()));

    expect(sleepUntilDateMock).toBeCalledTimes(2);
    expect(sleepUntilDateMock).toHaveBeenNthCalledWith(
      2,
      subDays(certificate2Date, 90),
      expect.anything(),
    );
    expect(mockRegisterWithPublicGateway).toBeCalledTimes(2);
    expect(mockRegisterWithPublicGateway).toHaveBeenCalledWith(publicGateway2PublicAddress);
    expect(mockRegisterWithPublicGateway).not.toHaveBeenCalledWith(DEFAULT_PUBLIC_GATEWAY);
  });

  test('Renewal should be logged', async () => {
    const certificate2Date = new Date();
    mockRegisterWithPublicGateway.mockResolvedValueOnce(certificate2Date);

    await consume(take(1, registrar.continuallyRenewRegistration()));

    expect(logs).toContainEqual(
      partialPinoLog('info', 'Renewed certificate with public gateway', {
        publicGatewayPublicAddress: DEFAULT_PUBLIC_GATEWAY,
        certificateExpiryDate: certificate2Date.toISOString(),
      }),
    );
  });

  describe('Registration errors', () => {
    const sleepSecondsMock = mockSleepSeconds();

    test('Errors should delay next attempt by 30 minutes', async () => {
      const registrationError = new Error('Something went wrong');
      mockRegisterWithPublicGateway.mockRejectedValueOnce(registrationError);
      mockRegisterWithPublicGateway.mockResolvedValueOnce(addDays(new Date(), 2));

      await consume(take(1, registrar.continuallyRenewRegistration()));

      expect(sleepSecondsMock).toHaveBeenCalledWith(minutesToSeconds(30));
      expect(mockRegisterWithPublicGateway).toBeCalledTimes(2);
      expect(sleepSecondsMock.mock.invocationCallOrder[0]).toBeLessThan(
        mockRegisterWithPublicGateway.mock.invocationCallOrder[1],
      );
    });

    test('UnreachableResolverError should be logged with level=INFO', async () => {
      const registrationError = new UnreachableResolverError('Disconnected from Internet');
      mockRegisterWithPublicGateway.mockRejectedValueOnce(registrationError);
      mockRegisterWithPublicGateway.mockResolvedValueOnce(addDays(new Date(), 2));

      await consume(take(1, registrar.continuallyRenewRegistration()));

      expect(logs).toContainEqual(
        partialPinoLog(
          'info',
          'Could not renew registration; we seem to be disconnected from the Internet',
          {
            err: expect.objectContaining({
              message: registrationError.message,
              type: UnreachableResolverError.name,
            }),
            publicGatewayPublicAddress: DEFAULT_PUBLIC_GATEWAY,
          },
        ),
      );
    });

    test('Other errors should be logged with level=WARNING', async () => {
      const registrationError = new Error('Unexpected');
      mockRegisterWithPublicGateway.mockRejectedValueOnce(registrationError);
      mockRegisterWithPublicGateway.mockResolvedValueOnce(addDays(new Date(), 2));

      await consume(take(1, registrar.continuallyRenewRegistration()));

      expect(logs).toContainEqual(
        partialPinoLog('warn', 'Failed to renew registration', {
          err: expect.objectContaining({
            message: registrationError.message,
            type: registrationError.name,
          }),
          publicGatewayPublicAddress: DEFAULT_PUBLIC_GATEWAY,
        }),
      );
    });
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
