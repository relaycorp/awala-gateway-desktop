import {
  Certificate,
  derSerializePublicKey,
  GSCClient,
  PrivateNodeRegistration,
  PrivateNodeRegistrationRequest,
  SessionKey,
  SessionKeyPair,
} from '@relaycorp/relaynet-core';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  MockGSCClient,
  PreRegisterNodeCall,
  RegisterNodeCall,
} from '@relaycorp/relaynet-testing';
import { Container } from 'typedi';

import { DEFAULT_INTERNET_GATEWAY_ADDRESS } from './constants';
import { Config, ConfigKey } from './Config';
import { getPromiseRejection } from './testUtils/promises';
import { InternetGatewayProtocolError } from './sync/internetGateway/errors';
import { arrayBufferFrom } from './testUtils/buffer';
import { PrivateGatewayManager } from './PrivateGatewayManager';
import { setUpTestDBConnection } from './testUtils/db';
import { useTemporaryAppDirs } from './testUtils/appDirs';
import { mockSpy } from './testUtils/jest';
import * as gscClient from './sync/internetGateway/gscClient';
import { PrivateGateway } from './PrivateGateway';

setUpTestDBConnection();

useTemporaryAppDirs();

let mockGSCClient: GSCClient | null;
beforeEach(() => {
  mockGSCClient = null;
});

const mockMakeGSCClient = mockSpy(jest.spyOn(gscClient, 'makeGSCClient'), () => mockGSCClient);

let internetGatewayIdCertificate: Certificate;
let internetGatewaySessionKey: SessionKey;
let idCertificate: Certificate;
beforeAll(async () => {
  const certPath = await generatePDACertificationPath(await generateIdentityKeyPairSet());
  internetGatewayIdCertificate = certPath.internetGateway;
  idCertificate = certPath.privateGateway;

  internetGatewaySessionKey = (await SessionKeyPair.generate()).sessionKey;
});

let privateGateway: PrivateGateway;
beforeEach(async () => {
  const manager = Container.get(PrivateGatewayManager);
  await manager.createCurrentIfMissing();
  privateGateway = await manager.getCurrent();
});

describe('registerWithInternetGateway', () => {
  const registrationAuth = arrayBufferFrom('the auth');
  let preRegisterCall: PreRegisterNodeCall;
  let registration: PrivateNodeRegistration;
  let registerCall: RegisterNodeCall;
  beforeEach(() => {
    preRegisterCall = new PreRegisterNodeCall(registrationAuth);

    registration = new PrivateNodeRegistration(
      idCertificate,
      internetGatewayIdCertificate,
      DEFAULT_INTERNET_GATEWAY_ADDRESS,
      internetGatewaySessionKey,
    );
    registerCall = new RegisterNodeCall(registration);

    mockGSCClient = new MockGSCClient([preRegisterCall, registerCall]);
  });

  beforeEach(async () => {
    await Container.get(PrivateGatewayManager).createCurrentIfMissing();
  });

  test('PoWeb client should connect to resolved address', async () => {
    await privateGateway.registerWithInternetGateway(DEFAULT_INTERNET_GATEWAY_ADDRESS);

    expect(mockMakeGSCClient).toBeCalledWith(DEFAULT_INTERNET_GATEWAY_ADDRESS);
  });

  test('PoWeb client should do pre-registration', async () => {
    await privateGateway.registerWithInternetGateway(DEFAULT_INTERNET_GATEWAY_ADDRESS);

    expect(preRegisterCall.wasCalled).toBeTruthy();
  });

  test('PoWeb client should complete registration with given authorisation', async () => {
    await privateGateway.registerWithInternetGateway(DEFAULT_INTERNET_GATEWAY_ADDRESS);

    expect(registerCall.wasCalled).toBeTruthy();
    const registrationRequest = await PrivateNodeRegistrationRequest.deserialize(
      registerCall.arguments!.pnrrSerialized,
    );
    await expect(derSerializePublicKey(registrationRequest.privateNodePublicKey)).resolves.toEqual(
      await derSerializePublicKey(preRegisterCall.arguments!.nodePublicKey),
    );
    expect(registrationRequest.pnraSerialized).toEqual(registrationAuth);
  });

  test('Channel with Internet gateway should be stored', async () => {
    const saveChannelSpy = jest.spyOn(PrivateGateway.prototype, 'saveInternetGatewayChannel');

    await privateGateway.registerWithInternetGateway(DEFAULT_INTERNET_GATEWAY_ADDRESS);

    expect(saveChannelSpy).toBeCalledWith(
      idCertificate,
      internetGatewayIdCertificate,
      internetGatewaySessionKey,
    );
  });

  test('Id of Internet gateway should be stored in config', async () => {
    await privateGateway.registerWithInternetGateway(DEFAULT_INTERNET_GATEWAY_ADDRESS);

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.INTERNET_GATEWAY_ID)).resolves.toEqual(
      await internetGatewayIdCertificate.calculateSubjectId(),
    );
  });

  test('Expiry date of private gateway certificate should be returned', async () => {
    await expect(
      privateGateway.registerWithInternetGateway(DEFAULT_INTERNET_GATEWAY_ADDRESS),
    ).resolves.toEqual(idCertificate.expiryDate);
  });

  test('Error should be thrown if registration fails', async () => {
    const originalError = new Error('oh noes');
    registerCall = new RegisterNodeCall(originalError);
    mockGSCClient = new MockGSCClient([preRegisterCall, registerCall]);

    const error = await getPromiseRejection(
      privateGateway.registerWithInternetGateway(DEFAULT_INTERNET_GATEWAY_ADDRESS),
      InternetGatewayProtocolError,
    );
    expect(error.message).toMatch(/^Failed to register with the Internet gateway:/);
    expect(error.cause()).toBe(originalError);
  });

  test('Error should be thrown if the Internet gateway session key is missing', async () => {
    registration = new PrivateNodeRegistration(
      idCertificate,
      internetGatewayIdCertificate,
      DEFAULT_INTERNET_GATEWAY_ADDRESS,
    );
    registerCall = new RegisterNodeCall(registration);
    mockGSCClient = new MockGSCClient([preRegisterCall, registerCall]);
    const saveChannelSpy = jest.spyOn(PrivateGateway.prototype, 'saveInternetGatewayChannel');

    await expect(
      privateGateway.registerWithInternetGateway(DEFAULT_INTERNET_GATEWAY_ADDRESS),
    ).rejects.toThrowWithMessage(
      InternetGatewayProtocolError,
      'Registration is missing Internet gateway session key',
    );

    expect(saveChannelSpy).not.toBeCalled();
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.INTERNET_GATEWAY_ADDRESS)).resolves.toBeNull();
    await expect(config.get(ConfigKey.INTERNET_GATEWAY_ID)).resolves.toBeNull();
  });

  test('Error should be thrown if the channel creation is rejected', async () => {
    registration = new PrivateNodeRegistration(
      idCertificate,
      idCertificate, // Invalid Internet gateway certificate
      DEFAULT_INTERNET_GATEWAY_ADDRESS,
      internetGatewaySessionKey,
    );
    registerCall = new RegisterNodeCall(registration);
    mockGSCClient = new MockGSCClient([preRegisterCall, registerCall]);

    await expect(
      privateGateway.registerWithInternetGateway(DEFAULT_INTERNET_GATEWAY_ADDRESS),
    ).rejects.toThrowWithMessage(
      InternetGatewayProtocolError,
      /^Failed to save channel with Internet gateway:/,
    );

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.INTERNET_GATEWAY_ADDRESS)).resolves.toBeNull();
    await expect(config.get(ConfigKey.INTERNET_GATEWAY_ID)).resolves.toBeNull();
  });
});
