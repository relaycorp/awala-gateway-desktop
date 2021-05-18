import { Certificate, DETACHED_SIGNATURE_TYPES } from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import { FastifyInstance } from 'fastify';
import { Response as LightMyRequestResponse } from 'light-my-request';
import { Container } from 'typedi';

import { DBPrivateKeyStore } from '../../keystores/DBPrivateKeyStore';
import { InvalidParcelError, MalformedParcelError, ParcelStore } from '../../parcelStore';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { arrayBufferFrom } from '../../testUtils/buffer';
import { setUpTestDBConnection } from '../../testUtils/db';
import { testDisallowedMethods } from '../../testUtils/http';
import { mockSpy } from '../../testUtils/jest';
import { makeMockLoggingFixture, partialPinoLog } from '../../testUtils/logging';
import { makeServer } from '../index';
import { CONTENT_TYPES } from './contentTypes';

const ENDPOINT_URL = '/v1/parcels';

const mockLogging = makeMockLoggingFixture();

setUpTestDBConnection();
useTemporaryAppDirs();

const mockStoreInternetBoundParcel = mockSpy(
  jest.spyOn(ParcelStore.prototype, 'storeInternetBoundParcel'),
);

let gatewayPrivateKey: CryptoKey;
let gatewayCertificate: Certificate;
let endpointPrivateKey: CryptoKey;
let endpointCertificate: Certificate;
beforeAll(async () => {
  const keyPairSet = await generateNodeKeyPairSet();
  const certPath = await generatePDACertificationPath(keyPairSet);

  gatewayPrivateKey = keyPairSet.privateGateway.privateKey;
  gatewayCertificate = certPath.privateGateway;

  endpointPrivateKey = keyPairSet.privateEndpoint.privateKey;
  endpointCertificate = certPath.privateEndpoint;
});

beforeEach(async () => {
  const privateKeyStore = Container.get(DBPrivateKeyStore);
  await privateKeyStore.saveNodeKey(gatewayPrivateKey, gatewayCertificate);
});

describe('Disallowed methods', () => {
  testDisallowedMethods(['POST'], ENDPOINT_URL, () => makeServer(mockLogging.logger));
});

test('Invalid request Content-Type should be refused with an HTTP 415 response', async () => {
  const fastify = await makeServer(mockLogging.logger);

  const response = await fastify.inject({
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    payload: '{}',
    url: ENDPOINT_URL,
  });

  expect(response).toHaveProperty('statusCode', 415);
  expect(mockStoreInternetBoundParcel).not.toBeCalled();
});

describe('Authorization errors', () => {
  test('Requests without Authorization header should result in HTTP 401', async () => {
    const fastify = await makeServer(mockLogging.logger);

    const response = await postParcel(arrayBufferFrom(''), fastify);

    expectResponseToRequireAuthentication(response);
    expect(mockStoreInternetBoundParcel).not.toBeCalled();
  });

  test('Requests with the wrong Authorization type should result in HTTP 401', async () => {
    const fastify = await makeServer(mockLogging.logger);

    const response = await postParcel(arrayBufferFrom(''), fastify, 'InvalidType value');

    expectResponseToRequireAuthentication(response);
    expect(mockStoreInternetBoundParcel).not.toBeCalled();
  });

  test('Requests with missing Authorization value should result in HTTP 401', async () => {
    const fastify = await makeServer(mockLogging.logger);

    const response = await postParcel(arrayBufferFrom(''), fastify, 'Relaynet-Countersignature ');

    expectResponseToRequireAuthentication(response);
    expect(mockStoreInternetBoundParcel).not.toBeCalled();
  });

  test('Malformed base64-encoded countersignatures should result in HTTP 401', async () => {
    const fastify = await makeServer(mockLogging.logger);

    const response = await postParcel(arrayBufferFrom(''), fastify, 'Relaynet-Countersignature .');

    expectResponseToRequireAuthentication(response);
    expect(mockStoreInternetBoundParcel).not.toBeCalled();
  });

  test('Invalid parcel delivery countersignatures should result in HTTP 401', async () => {
    const fastify = await makeServer(mockLogging.logger);
    const parcelSerialized = arrayBufferFrom('the parcel');
    const countersignature = await DETACHED_SIGNATURE_TYPES.PARCEL_DELIVERY.sign(
      parcelSerialized,
      endpointPrivateKey,
      gatewayCertificate, // Wrong certificate
    );

    const response = await postParcel(
      parcelSerialized,
      fastify,
      encodeAuthorizationHeaderValue(countersignature),
    );

    expectResponseToRequireAuthentication(response);
    expect(mockStoreInternetBoundParcel).not.toBeCalled();
  });

  function expectResponseToRequireAuthentication(response: LightMyRequestResponse): void {
    expect(response).toHaveProperty('statusCode', 401);
    expect(response).toHaveProperty('headers.www-authenticate', 'Relaynet-Countersignature');
    expect(JSON.parse(response.payload)).toHaveProperty(
      'message',
      'Parcel delivery countersignature is either missing or invalid',
    );
  }
});

test('Malformed parcels should be refused with an HTTP 400 response', async () => {
  const fastify = await makeServer(mockLogging.logger);
  const parcelSerialized = arrayBufferFrom('malformed');
  const error = new MalformedParcelError('yup, malformed');
  mockStoreInternetBoundParcel.mockRejectedValue(error);

  const response = await postParcel(
    parcelSerialized,
    fastify,
    await countersignParcelDelivery(parcelSerialized),
  );

  expect(response).toHaveProperty('statusCode', 400);
  expect(JSON.parse(response.payload)).toHaveProperty('message', 'Parcel is malformed');
  expect(mockLogging.logs).toContainEqual(
    partialPinoLog('info', 'Rejected malformed parcel', {
      err: expect.objectContaining({ message: error.message }),
    }),
  );
});

test('Well-formed yet invalid parcels should be refused with an HTTP 422 response', async () => {
  const fastify = await makeServer(mockLogging.logger);
  const parcelSerialized = arrayBufferFrom('invalid');
  const error = new InvalidParcelError('Well-formed but invalid');
  mockStoreInternetBoundParcel.mockRejectedValue(error);

  const response = await postParcel(
    parcelSerialized,
    fastify,
    await countersignParcelDelivery(parcelSerialized),
  );

  expect(response).toHaveProperty('statusCode', 422);
  expect(JSON.parse(response.payload)).toHaveProperty(
    'message',
    'Parcel is well-formed but invalid',
  );
  expect(mockLogging.logs).toContainEqual(
    partialPinoLog('info', 'Rejected invalid parcel', {
      err: expect.objectContaining({ message: error.message }),
    }),
  );
});

test('Valid parcels should result in an HTTP 202 response', async () => {
  const fastify = await makeServer(mockLogging.logger);
  const parcelSerialized = arrayBufferFrom('valid parcel');

  const response = await postParcel(
    parcelSerialized,
    fastify,
    await countersignParcelDelivery(parcelSerialized),
  );

  expect(mockStoreInternetBoundParcel).toBeCalledWith(parcelSerialized);
  expect(response).toHaveProperty('statusCode', 202);
  expect(JSON.parse(response.payload)).toHaveProperty(
    'message',
    'Parcel is well-formed but invalid',
  );
  expect(mockLogging.logs).toContainEqual(partialPinoLog('info', 'Parcel was successfully saved'));
});

test('Failing to save a valid parcel should result in an HTTP 500 response', async () => {
  const fastify = await makeServer(mockLogging.logger);
  const parcelSerialized = arrayBufferFrom('this is a parcel');
  const error = new Error('whoops');
  mockStoreInternetBoundParcel.mockRejectedValue(error);

  const response = await postParcel(
    parcelSerialized,
    fastify,
    await countersignParcelDelivery(parcelSerialized),
  );

  expect(response).toHaveProperty('statusCode', 500);
  expect(JSON.parse(response.payload)).toHaveProperty('message', 'Internal server error');
  expect(mockLogging.logs).toContainEqual(
    partialPinoLog('error', 'Failed to store parcel', {
      err: expect.objectContaining({ message: error.message }),
    }),
  );
});

async function postParcel(
  parcelSerialized: Buffer | ArrayBuffer,
  fastify: FastifyInstance,
  authorizationHeaderValue?: string,
  contentType = CONTENT_TYPES.PARCEL,
): Promise<LightMyRequestResponse> {
  return fastify.inject({
    headers: {
      'content-type': contentType,
      ...(authorizationHeaderValue && { authorization: authorizationHeaderValue }),
    },
    method: 'POST',
    payload: Buffer.from(parcelSerialized),
    url: ENDPOINT_URL,
  });
}

async function countersignParcelDelivery(parcelSerialized: ArrayBuffer): Promise<string> {
  const countersignature = await DETACHED_SIGNATURE_TYPES.PARCEL_DELIVERY.sign(
    parcelSerialized,
    endpointPrivateKey,
    endpointCertificate,
  );
  return encodeAuthorizationHeaderValue(countersignature);
}

function encodeAuthorizationHeaderValue(countersignatureDER: ArrayBuffer): string {
  const countersignatureBase64 = Buffer.from(countersignatureDER).toString('base64');
  return `Relaynet-Countersignature ${countersignatureBase64}`;
}
