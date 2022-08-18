import { UnreachableResolverError } from '@relaycorp/relaynet-core';
import { addDays, minutesToSeconds, subDays } from 'date-fns';
import { consume, take } from 'streaming-iterables';
import { Container } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_INTERNET_GATEWAY_ADDRESS } from '../../constants';
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

const mockRegisterWithInternetGateway = mockSpy(
  jest.spyOn(PrivateGateway.prototype, 'registerWithInternetGateway'),
  async () => {
    const privateGatewayCertificate = pkiFixtureRetriever().pdaCertPath.privateGateway;
    return privateGatewayCertificate.expiryDate;
  },
);

const sleepSeconds = mockSleepSeconds();

describe('register', () => {
  beforeEach(undoGatewayRegistration);

  test('Registration should be skipped if already registered with new gateway', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.INTERNET_GATEWAY_ADDRESS, DEFAULT_INTERNET_GATEWAY_ADDRESS);

    await registrar.register(DEFAULT_INTERNET_GATEWAY_ADDRESS);

    expect(mockRegisterWithInternetGateway).not.toBeCalled();
    expect(logs).toContainEqual(
      partialPinoLog('debug', 'Skipping registration with Internet gateway'),
    );
  });

  test('Registration should be completed if not already registered with peer', async () => {
    await registrar.register(DEFAULT_INTERNET_GATEWAY_ADDRESS);

    expect(mockRegisterWithInternetGateway).toBeCalledWith(DEFAULT_INTERNET_GATEWAY_ADDRESS);
    const privateGatewayCertificate = pkiFixtureRetriever().pdaCertPath.privateGateway;
    expect(logs).toContainEqual(
      partialPinoLog('info', 'Successfully registered with Internet gateway', {
        privateGatewayCertificateExpiryDate: privateGatewayCertificate.expiryDate.toISOString(),
        internetGatewayAddress: DEFAULT_INTERNET_GATEWAY_ADDRESS,
      }),
    );
  });

  test('Internet address of Internet gateway should be stored in config', async () => {
    await registrar.register(DEFAULT_INTERNET_GATEWAY_ADDRESS);

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.INTERNET_GATEWAY_ADDRESS)).resolves.toEqual(
      DEFAULT_INTERNET_GATEWAY_ADDRESS,
    );
  });

  test('Registration errors should be propagated', async () => {
    const originalError = new Error('oh noes');
    mockRegisterWithInternetGateway.mockRejectedValue(originalError);

    await expect(registrar.register(DEFAULT_INTERNET_GATEWAY_ADDRESS)).rejects.toBe(originalError);
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

  test('Registration should proceed if unregistered', async () => {
    mockIsRegistered.mockResolvedValueOnce(false);
    mockIsRegistered.mockResolvedValueOnce(true);
    mockRegister.mockResolvedValueOnce(undefined);

    await registrar.waitForRegistration();

    expect(mockRegister).toBeCalledTimes(1);
    expect(mockRegister).toBeCalledWith(DEFAULT_INTERNET_GATEWAY_ADDRESS);
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
    expect(mockRegister).toBeCalledWith(DEFAULT_INTERNET_GATEWAY_ADDRESS);
    expect(sleepSeconds).toBeCalledWith(5);
    expect(logs).toContainEqual(
      partialPinoLog(
        'debug',
        'Failed to register with Internet gateway because DNS resolver is unreachable',
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
    expect(mockRegister).toBeCalledWith(DEFAULT_INTERNET_GATEWAY_ADDRESS);
    expect(sleepSeconds).toBeCalledWith(60);
    expect(logs).toContainEqual(
      partialPinoLog('error', 'Failed to register with Internet gateway', {
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
    expect(mockRegister).toBeCalledWith(DEFAULT_INTERNET_GATEWAY_ADDRESS);
    expect(sleepSeconds).toBeCalledWith(60);
    expect(logs).toContainEqual(
      partialPinoLog('error', 'Failed to register with Internet gateway', {
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
    expect(mockRegisterWithInternetGateway).toBeCalled();
    expect(logs).toContainEqual(
      partialPinoLog('info', 'Scheduling registration renewal', {
        nextRenewalDate: expectedScheduledDate.toISOString(),
      }),
    );
  });

  test('Renewals should be repeated indefinitely', async () => {
    const certificate1Date = pkiFixtureRetriever().pdaCertPath.privateGateway.expiryDate;
    const certificate2Date = new Date();
    mockRegisterWithInternetGateway.mockResolvedValueOnce(certificate2Date);

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
    expect(mockRegisterWithInternetGateway).toBeCalledTimes(2);
  });

  test('Internet gateway migrations should be reflected', async () => {
    // Migrate to a different Internet gateway before the first renewal
    const internetGateway2Address = `not-${DEFAULT_INTERNET_GATEWAY_ADDRESS}`;
    sleepUntilDateMock.mockImplementationOnce(async () => {
      await registrar.register(internetGateway2Address);
    });
    sleepUntilDateMock.mockResolvedValueOnce(undefined);
    const certificate2Date = addDays(new Date(), 3);
    mockRegisterWithInternetGateway.mockResolvedValueOnce(certificate2Date);

    await consume(take(1, registrar.continuallyRenewRegistration()));

    expect(sleepUntilDateMock).toBeCalledTimes(2);
    expect(sleepUntilDateMock).toHaveBeenNthCalledWith(
      2,
      subDays(certificate2Date, 90),
      expect.anything(),
    );
    expect(mockRegisterWithInternetGateway).toBeCalledTimes(2);
    expect(mockRegisterWithInternetGateway).toHaveBeenCalledWith(internetGateway2Address);
    expect(mockRegisterWithInternetGateway).not.toHaveBeenCalledWith(
      DEFAULT_INTERNET_GATEWAY_ADDRESS,
    );
  });

  test('Renewal should be logged', async () => {
    const certificate2Date = new Date();
    mockRegisterWithInternetGateway.mockResolvedValueOnce(certificate2Date);

    await consume(take(1, registrar.continuallyRenewRegistration()));

    expect(logs).toContainEqual(
      partialPinoLog('info', 'Renewed certificate with Internet gateway', {
        internetGatewayAddress: DEFAULT_INTERNET_GATEWAY_ADDRESS,
        certificateExpiryDate: certificate2Date.toISOString(),
      }),
    );
  });

  describe('Registration errors', () => {
    test('Errors should delay next attempt by 30 minutes', async () => {
      const registrationError = new Error('Something went wrong');
      mockRegisterWithInternetGateway.mockRejectedValueOnce(registrationError);
      mockRegisterWithInternetGateway.mockResolvedValueOnce(addDays(new Date(), 2));

      await consume(take(1, registrar.continuallyRenewRegistration()));

      expect(sleepSeconds).toHaveBeenCalledWith(minutesToSeconds(30));
      expect(mockRegisterWithInternetGateway).toBeCalledTimes(2);
      expect(sleepSeconds.mock.invocationCallOrder[0]).toBeLessThan(
        mockRegisterWithInternetGateway.mock.invocationCallOrder[1],
      );
    });

    test('UnreachableResolverError should be logged with level=INFO', async () => {
      const registrationError = new UnreachableResolverError('Disconnected from Internet');
      mockRegisterWithInternetGateway.mockRejectedValueOnce(registrationError);
      mockRegisterWithInternetGateway.mockResolvedValueOnce(addDays(new Date(), 2));

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
            internetGatewayAddress: DEFAULT_INTERNET_GATEWAY_ADDRESS,
          },
        ),
      );
    });

    test('Other errors should be logged with level=WARNING', async () => {
      const registrationError = new Error('Unexpected');
      mockRegisterWithInternetGateway.mockRejectedValueOnce(registrationError);
      mockRegisterWithInternetGateway.mockResolvedValueOnce(addDays(new Date(), 2));

      await consume(take(1, registrar.continuallyRenewRegistration()));

      expect(logs).toContainEqual(
        partialPinoLog('warn', 'Failed to renew registration', {
          err: expect.objectContaining({
            message: registrationError.message,
            type: registrationError.name,
          }),
          internetGatewayAddress: DEFAULT_INTERNET_GATEWAY_ADDRESS,
        }),
      );
    });
  });
});

describe('isRegistered', () => {
  beforeEach(undoGatewayRegistration);

  test('True should be returned if gateway is registered', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.INTERNET_GATEWAY_ADDRESS, DEFAULT_INTERNET_GATEWAY_ADDRESS);

    await expect(registrar.isRegistered()).resolves.toBeTrue();
  });

  test('False should be returned if gateway is unregistered', async () => {
    await expect(registrar.isRegistered()).resolves.toBeFalse();
  });
});
