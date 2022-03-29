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

import { DEFAULT_PUBLIC_GATEWAY } from './constants';
import { Config, ConfigKey } from './Config';
import { getPromiseRejection } from './testUtils/promises';
import { PublicGatewayProtocolError } from './sync/publicGateway/errors';
import { arrayBufferFrom } from './testUtils/buffer';
import { PrivateGatewayManager } from './PrivateGatewayManager';
import { setUpTestDBConnection } from './testUtils/db';
import { useTemporaryAppDirs } from './testUtils/appDirs';
import { mockSpy } from './testUtils/jest';
import * as gscClient from './sync/publicGateway/gscClient';
import { PrivateGateway } from './PrivateGateway';

setUpTestDBConnection();

useTemporaryAppDirs();

let mockGSCClient: GSCClient | null;
beforeEach(() => {
  mockGSCClient = null;
});

const mockMakeGSCClient = mockSpy(jest.spyOn(gscClient, 'makeGSCClient'), () => mockGSCClient);

let publicGatewayIdCertificate: Certificate;
let publicGatewaySessionKey: SessionKey;
let idCertificate: Certificate;
beforeAll(async () => {
  const certPath = await generatePDACertificationPath(await generateIdentityKeyPairSet());
  publicGatewayIdCertificate = certPath.publicGateway;
  idCertificate = certPath.privateGateway;

  publicGatewaySessionKey = (await SessionKeyPair.generate()).sessionKey;
});

let privateGateway: PrivateGateway;
beforeEach(async () => {
  const manager = Container.get(PrivateGatewayManager);
  await manager.createCurrentIfMissing();
  privateGateway = await manager.getCurrent();
});

describe('registerWithPublicGateway', () => {
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

  beforeEach(async () => {
    await Container.get(PrivateGatewayManager).createCurrentIfMissing();
  });

  test('PoWeb client should connect to resolved address', async () => {
    await privateGateway.registerWithPublicGateway(DEFAULT_PUBLIC_GATEWAY);

    expect(mockMakeGSCClient).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY);
  });

  test('PoWeb client should do pre-registration', async () => {
    await privateGateway.registerWithPublicGateway(DEFAULT_PUBLIC_GATEWAY);

    expect(preRegisterCall.wasCalled).toBeTruthy();
  });

  test('PoWeb client should complete registration with given authorisation', async () => {
    await privateGateway.registerWithPublicGateway(DEFAULT_PUBLIC_GATEWAY);

    expect(registerCall.wasCalled).toBeTruthy();
    const registrationRequest = await PrivateNodeRegistrationRequest.deserialize(
      registerCall.arguments!.pnrrSerialized,
    );
    await expect(derSerializePublicKey(registrationRequest.privateNodePublicKey)).resolves.toEqual(
      await derSerializePublicKey(preRegisterCall.arguments!.nodePublicKey),
    );
    expect(registrationRequest.pnraSerialized).toEqual(registrationAuth);
  });

  test('Channel with public gateway should be stored', async () => {
    const saveChannelSpy = jest.spyOn(PrivateGateway.prototype, 'savePublicGatewayChannel');

    await privateGateway.registerWithPublicGateway(DEFAULT_PUBLIC_GATEWAY);

    expect(saveChannelSpy).toBeCalledWith(
      idCertificate,
      publicGatewayIdCertificate,
      publicGatewaySessionKey,
    );
  });

  test('Private address of public gateway should be stored in config', async () => {
    await privateGateway.registerWithPublicGateway(DEFAULT_PUBLIC_GATEWAY);

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.PUBLIC_GATEWAY_PRIVATE_ADDRESS)).resolves.toEqual(
      await publicGatewayIdCertificate.calculateSubjectPrivateAddress(),
    );
  });

  test('Expiry date of private gateway certificate should be returned', async () => {
    await expect(privateGateway.registerWithPublicGateway(DEFAULT_PUBLIC_GATEWAY)).resolves.toEqual(
      idCertificate.expiryDate,
    );
  });

  test('Error should be thrown if registration fails', async () => {
    const originalError = new Error('oh noes');
    registerCall = new RegisterNodeCall(originalError);
    mockGSCClient = new MockGSCClient([preRegisterCall, registerCall]);

    const error = await getPromiseRejection(
      privateGateway.registerWithPublicGateway(DEFAULT_PUBLIC_GATEWAY),
      PublicGatewayProtocolError,
    );
    expect(error.message).toMatch(/^Failed to register with the public gateway:/);
    expect(error.cause()).toBe(originalError);
  });

  test('Error should be thrown if the public gateway session key is missing', async () => {
    registration = new PrivateNodeRegistration(idCertificate, publicGatewayIdCertificate);
    registerCall = new RegisterNodeCall(registration);
    mockGSCClient = new MockGSCClient([preRegisterCall, registerCall]);
    const saveChannelSpy = jest.spyOn(PrivateGateway.prototype, 'savePublicGatewayChannel');

    await expect(
      privateGateway.registerWithPublicGateway(DEFAULT_PUBLIC_GATEWAY),
    ).rejects.toThrowWithMessage(
      PublicGatewayProtocolError,
      'Registration is missing public gateway session key',
    );

    expect(saveChannelSpy).not.toBeCalled();
    const config = Container.get(Config);
    await expect(config.get(ConfigKey.PUBLIC_GATEWAY_PUBLIC_ADDRESS)).resolves.toBeNull();
    await expect(config.get(ConfigKey.PUBLIC_GATEWAY_PRIVATE_ADDRESS)).resolves.toBeNull();
  });

  test('Error should be thrown if the channel creation is rejected', async () => {
    registration = new PrivateNodeRegistration(
      idCertificate,
      idCertificate, // Invalid public gateway certificate
      publicGatewaySessionKey,
    );
    registerCall = new RegisterNodeCall(registration);
    mockGSCClient = new MockGSCClient([preRegisterCall, registerCall]);

    await expect(
      privateGateway.registerWithPublicGateway(DEFAULT_PUBLIC_GATEWAY),
    ).rejects.toThrowWithMessage(
      PublicGatewayProtocolError,
      /^Failed to save channel with public gateway:/,
    );

    const config = Container.get(Config);
    await expect(config.get(ConfigKey.PUBLIC_GATEWAY_PUBLIC_ADDRESS)).resolves.toBeNull();
    await expect(config.get(ConfigKey.PUBLIC_GATEWAY_PRIVATE_ADDRESS)).resolves.toBeNull();
  });
});
