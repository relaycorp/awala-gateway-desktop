import {
  Certificate,
  derSerializePublicKey,
  GSCClient,
  PrivateNodeRegistration,
  PrivateNodeRegistrationRequest,
  SessionKey,
  SessionKeyPair,
  UnreachableResolverError,
} from '@relaycorp/relaynet-core';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  MockGSCClient,
  PreRegisterNodeCall,
  RegisterNodeCall,
} from '@relaycorp/relaynet-testing';
import { Container } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { FileStore } from '../../fileStore';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { arrayBufferFrom } from '../../testUtils/buffer';
import { setUpTestDBConnection } from '../../testUtils/db';
import { mockSpy } from '../../testUtils/jest';
import { mockPrivateKeyStore, mockPublicKeyStore } from '../../testUtils/keystores';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { mockSleepSeconds } from '../../testUtils/timing';
import { GatewayRegistrar } from './GatewayRegistrar';
import * as gscClient from './gscClient';
import { NonExistingAddressError, PublicGatewayProtocolError } from './errors';
import { getPromiseRejection } from '../../testUtils/promises';

setUpTestDBConnection();

const privateKeyStore = mockPrivateKeyStore();
const publicKeyStore = mockPublicKeyStore();

useTemporaryAppDirs();

const logs = mockLoggerToken();

let registrar: GatewayRegistrar;
beforeEach(() => {
  registrar = Container.get(GatewayRegistrar);
});

let mockGSCClient: GSCClient | null;
beforeEach(() => {
  mockGSCClient = null;
});

const mockMakeGSCClient = mockSpy(jest.spyOn(gscClient, 'makeGSCClient'), () => mockGSCClient);

const mockFileStoreGetObject = mockSpy(jest.spyOn(FileStore.prototype, 'getObject'));
const mockFileStorePutObject = mockSpy(jest.spyOn(FileStore.prototype, 'putObject'));

let publicGatewayIdCertificate: Certificate;
let publicGatewaySessionKey: SessionKey;
let idCertificate: Certificate;
beforeAll(async () => {
  const certPath = await generatePDACertificationPath(await generateIdentityKeyPairSet());
  publicGatewayIdCertificate = certPath.publicGateway;
  idCertificate = certPath.privateGateway;

  publicGatewaySessionKey = (await SessionKeyPair.generate()).sessionKey;
});

describe('register', () => {
  const registrationAuth = arrayBufferFrom('the auth');
  let preRegisterCall: PreRegisterNodeCall;
  let registration: PrivateNodeRegistration;
  let registerCall: RegisterNodeCall;
  beforeEach(() => {
    preRegisterCall = new PreRegisterNodeCall(registrationAuth);

    registration = new PrivateNodeRegistration(
      idCertificate,
      publicGatewayIdCertificate,
      publicGatewaySessionKey,
    );
    registerCall = new RegisterNodeCall(registration);

    mockGSCClient = new MockGSCClient([preRegisterCall, registerCall]);
  });

  test('Registration should be skipped if already registered with new gateway', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.PUBLIC_GATEWAY_ADDRESS, DEFAULT_PUBLIC_GATEWAY);

    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    expect(mockMakeGSCClient).not.toBeCalled();
    expect(preRegisterCall.wasCalled).toBeFalsy();
    expect(logs).toContainEqual(
      partialPinoLog('debug', 'Skipping registration with public gateway'),
    );
  });

  test('PoWeb client should complete registration with resolved address', async () => {
    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    expect(mockMakeGSCClient).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
    expect(logs).toContainEqual(
      partialPinoLog('info', 'Successfully registered with public gateway', {
        publicGatewayPublicAddress: DEFAULT_PUBLIC_GATEWAY,
        publicGatewayPrivateAddress:
          await publicGatewayIdCertificate.calculateSubjectPrivateAddress(),
      }),
    );
  });

  test('PoWeb client should do pre-registration', async () => {
    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    expect(preRegisterCall.wasCalled).toBeTruthy();
  });

  test('PoWeb client should complete registration with given authorisation', async () => {
    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    expect(registerCall.wasCalled).toBeTruthy();
    const registrationRequest = await PrivateNodeRegistrationRequest.deserialize(
      registerCall.arguments!.pnrrSerialized,
    );
    await expect(derSerializePublicKey(registrationRequest.privateNodePublicKey)).resolves.toEqual(
      await derSerializePublicKey(preRegisterCall.arguments!.nodePublicKey),
    );
    expect(registrationRequest.pnraSerialized).toEqual(registrationAuth);
  });

  test('Private gateway certificate should be stored along with private key', async () => {
    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    const key = await privateKeyStore.fetchNodeKey(idCertificate.getSerialNumber());
    expect(key.certificate.isEqual(idCertificate)).toBeTruthy();
  });

  test('Public gateway certificate should be stored', async () => {
    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    expect(mockFileStorePutObject).toBeCalledWith(
      Buffer.from(publicGatewayIdCertificate.serialize()),
      'public-gateway-id-certificate.der',
    );
  });

  test('Public gateway address should be stored in config', async () => {
    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.PUBLIC_GATEWAY_ADDRESS)).resolves.toEqual(
      DEFAULT_PUBLIC_GATEWAY,
    );
  });

  test('Node key serial number should be stored in config as hex', async () => {
    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.NODE_KEY_SERIAL_NUMBER)).resolves.toEqual(
      idCertificate.getSerialNumberHex(),
    );
  });

  test('Public gateway session key should be stored', async () => {
    await registrar.register(DEFAULT_PUBLIC_GATEWAY);

    const storedPublicGatewaySessionKey = await publicKeyStore.fetchLastSessionKey(
      await publicGatewayIdCertificate.calculateSubjectPrivateAddress(),
    );
    expect(storedPublicGatewaySessionKey).toEqual(publicGatewaySessionKey);
  });

  test('Error should be thrown if registration fails', async () => {
    const originalError = new Error('oh noes');
    registerCall = new RegisterNodeCall(originalError);
    mockGSCClient = new MockGSCClient([preRegisterCall, registerCall]);

    const error = await getPromiseRejection(
      registrar.register(DEFAULT_PUBLIC_GATEWAY),
      PublicGatewayProtocolError,
    );
    expect(error.message).toMatch(/^Failed to register with the public gateway:/);
    expect(error.cause()).toBe(originalError);
  });

  test('Error should be thrown if the public gateway session key is missing', async () => {
    registration = new PrivateNodeRegistration(idCertificate, publicGatewayIdCertificate);
    registerCall = new RegisterNodeCall(registration);
    mockGSCClient = new MockGSCClient([preRegisterCall, registerCall]);

    await expect(registrar.register(DEFAULT_PUBLIC_GATEWAY)).rejects.toThrowWithMessage(
      PublicGatewayProtocolError,
      'Registration is missing public gateway session key',
    );
    expect(Object.values(privateKeyStore.keys)).toHaveLength(0);
    expect(mockFileStorePutObject).not.toBeCalled();
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.NODE_KEY_SERIAL_NUMBER)).resolves.toBeNull();
    await expect(config.get(ConfigKey.PUBLIC_GATEWAY_ADDRESS)).resolves.toBeNull();
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
  test('True should be returned if gateway is registered', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.PUBLIC_GATEWAY_ADDRESS, DEFAULT_PUBLIC_GATEWAY);

    await expect(registrar.isRegistered()).resolves.toBeTrue();
  });

  test('False should be returned if gateway is unregistered', async () => {
    await expect(registrar.isRegistered()).resolves.toBeFalse();
  });
});

describe('getPublicGateway', () => {
  test('Null should be returned if public gateway address cannot be found', async () => {
    mockFileStoreGetObject.mockResolvedValue(Buffer.from(publicGatewayIdCertificate.serialize()));

    await expect(registrar.getPublicGateway()).resolves.toBeNull();
  });

  test('Null should be returned if public gateway id certificate cannot be found', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.PUBLIC_GATEWAY_ADDRESS, DEFAULT_PUBLIC_GATEWAY);

    await expect(registrar.getPublicGateway()).resolves.toBeNull();
  });

  test('Public gateway data should be returned if registered', async () => {
    const config = Container.get(Config);
    await config.set(ConfigKey.PUBLIC_GATEWAY_ADDRESS, DEFAULT_PUBLIC_GATEWAY);
    mockFileStoreGetObject.mockResolvedValue(Buffer.from(publicGatewayIdCertificate.serialize()));

    const publicGateway = await registrar.getPublicGateway();

    expect(publicGateway!.publicAddress).toEqual(DEFAULT_PUBLIC_GATEWAY);
    expect(publicGateway!.identityCertificate.isEqual(publicGatewayIdCertificate)).toBeTrue();
  });
});
