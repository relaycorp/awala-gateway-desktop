import {
  Certificate,
  InvalidMessageError,
  Parcel,
  ParcelDeliverySigner,
  RAMFSyntaxError,
} from '@relaycorp/relaynet-core';
import { subSeconds } from 'date-fns';
import { FastifyInstance } from 'fastify';
import { Response as LightMyRequestResponse } from 'light-my-request';

import { ParcelStore } from '../../parcelStore';
import { ParcelDeliveryManager } from '../../sync/publicGateway/parcelDelivery/ParcelDeliveryManager';
import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { arrayBufferFrom } from '../../testUtils/buffer';
import { generatePKIFixture, mockGatewayRegistration } from '../../testUtils/crypto';
import { setUpTestDBConnection } from '../../testUtils/db';
import { testDisallowedMethods } from '../../testUtils/http';
import { mockSpy } from '../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../testUtils/logging';
import { makeServer } from '../index';
import { CONTENT_TYPES } from './contentTypes';

const ENDPOINT_URL = '/v1/parcels';

setUpTestDBConnection();
useTemporaryAppDirs();
const mockLogs = mockLoggerToken();

const mockStoreInternetBoundParcel = mockSpy(
  jest.spyOn(ParcelStore.prototype, 'storeInternetBound'),
);
const mockParcelDeliveryManagerNotifier = mockSpy(
  jest.spyOn(ParcelDeliveryManager.prototype, 'notifyAboutNewParcel'),
);

let gatewayCertificate: Certificate;
let endpointPrivateKey: CryptoKey;
let endpointCertificate: Certificate;
const pkiFixtureRetriever = generatePKIFixture((keyPairSet, certPath) => {
  gatewayCertificate = certPath.privateGateway;

  endpointPrivateKey = keyPairSet.privateEndpoint.privateKey!;
  endpointCertificate = certPath.privateEndpoint;
});
const { undoGatewayRegistration } = mockGatewayRegistration(pkiFixtureRetriever);

describe('Disallowed methods', () => {
  testDisallowedMethods(['POST'], ENDPOINT_URL, () => makeServer());
});

test('Invalid request Content-Type should be refused with an HTTP 415 response', async () => {
  const fastify = await makeServer();

  const response = await fastify.inject({
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    payload: '{}',
    url: ENDPOINT_URL,
  });

  expect(response).toHaveProperty('statusCode', 415);
  expect(mockStoreInternetBoundParcel).not.toBeCalled();
});

test('Requesting before registration should result in HTTP 500', async () => {
  const fastify = await makeServer();
  await undoGatewayRegistration();

  const response = await postParcel(arrayBufferFrom(''), fastify);

  expect(response).toHaveProperty('statusCode', 500);
  expect(JSON.parse(response.payload)).toHaveProperty(
    'message',
    'Private gateway is currently unregistered',
  );
  expect(mockLogs).toContainEqual(
    partialPinoLog('info', 'Refusing parcel delivery because private gateway is unregistered'),
  );
  expect(mockStoreInternetBoundParcel).not.toBeCalled();
});

describe('Authorization errors', () => {
  test('Requests without Authorization header should result in HTTP 401', async () => {
    const fastify = await makeServer();

    const response = await postParcel(arrayBufferFrom(''), fastify);

    expectResponseToRequireAuthentication(response);
    expect(mockStoreInternetBoundParcel).not.toBeCalled();
  });

  test('Requests with the wrong Authorization type should result in HTTP 401', async () => {
    const fastify = await makeServer();

    const response = await postParcel(arrayBufferFrom(''), fastify, 'InvalidType value');

    expectResponseToRequireAuthentication(response);
    expect(mockStoreInternetBoundParcel).not.toBeCalled();
  });

  test('Requests with missing Authorization value should result in HTTP 401', async () => {
    const fastify = await makeServer();

    const response = await postParcel(arrayBufferFrom(''), fastify, 'Relaynet-Countersignature ');

    expectResponseToRequireAuthentication(response);
    expect(mockStoreInternetBoundParcel).not.toBeCalled();
  });

  test('Malformed base64-encoded countersignatures should result in HTTP 401', async () => {
    const fastify = await makeServer();

    const response = await postParcel(arrayBufferFrom(''), fastify, 'Relaynet-Countersignature .');

    expectResponseToRequireAuthentication(response);
    expect(mockStoreInternetBoundParcel).not.toBeCalled();
  });

  test('Invalid parcel delivery countersignatures should result in HTTP 401', async () => {
    const fastify = await makeServer();
    const parcelSerialized = arrayBufferFrom('the parcel');
    const signer = new ParcelDeliverySigner(
      gatewayCertificate, // Wrong certificate
      endpointPrivateKey,
    );
    const countersignature = await signer.sign(parcelSerialized);

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
  const fastify = await makeServer();
  const parcelSerialized = arrayBufferFrom('malformed');

  const response = await postParcel(
    parcelSerialized,
    fastify,
    await countersignParcelDelivery(parcelSerialized),
  );

  expect(response).toHaveProperty('statusCode', 400);
  expect(JSON.parse(response.payload)).toHaveProperty('message', 'Parcel is malformed');
  expect(mockLogs).toContainEqual(
    partialPinoLog('info', 'Rejected malformed parcel', {
      err: expect.objectContaining({ type: RAMFSyntaxError.name }),
    }),
  );
});

test('Well-formed yet invalid parcels should be refused with an HTTP 422 response', async () => {
  const fastify = await makeServer();
  const parcel = new Parcel('https://example.com', endpointCertificate, Buffer.from([]), {
    creationDate: subSeconds(new Date(), 2),
    ttl: 1,
  });
  const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

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
  expect(mockLogs).toContainEqual(
    partialPinoLog('info', 'Rejected invalid parcel', {
      err: expect.objectContaining({ type: InvalidMessageError.name }),
    }),
  );
});

test('Valid parcels should result in an HTTP 202 response', async () => {
  const fastify = await makeServer();
  const parcel = new Parcel('https://example.com', endpointCertificate, Buffer.from([]));
  const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));

  const response = await postParcel(
    parcelSerialized,
    fastify,
    await countersignParcelDelivery(parcelSerialized),
  );

  expect(mockStoreInternetBoundParcel).toBeCalledWith(
    parcelSerialized,
    expect.toSatisfy((p) => p.id === parcel.id),
  );
  expect(mockParcelDeliveryManagerNotifier).toBeCalledWith(
    mockStoreInternetBoundParcel.mock.results[0].value,
  );
  expect(response).toHaveProperty('statusCode', 202);
  expect(JSON.parse(response.payload)).toHaveProperty(
    'message',
    'Parcel is well-formed but invalid',
  );
  expect(mockLogs).toContainEqual(partialPinoLog('info', 'Parcel was successfully saved'));
});

test('Failing to save a valid parcel should result in an HTTP 500 response', async () => {
  const fastify = await makeServer();
  const parcel = new Parcel('https://example.com', endpointCertificate, Buffer.from([]));
  const parcelSerialized = Buffer.from(await parcel.serialize(endpointPrivateKey));
  const error = new Error('whoops');
  mockStoreInternetBoundParcel.mockRejectedValue(error);

  const response = await postParcel(
    parcelSerialized,
    fastify,
    await countersignParcelDelivery(parcelSerialized),
  );

  expect(response).toHaveProperty('statusCode', 500);
  expect(JSON.parse(response.payload)).toHaveProperty('message', 'Internal server error');
  expect(mockLogs).toContainEqual(
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
  const signer = new ParcelDeliverySigner(endpointCertificate, endpointPrivateKey);
  const countersignature = await signer.sign(parcelSerialized);
  return encodeAuthorizationHeaderValue(countersignature);
}

function encodeAuthorizationHeaderValue(countersignatureDER: ArrayBuffer): string {
  const countersignatureBase64 = Buffer.from(countersignatureDER).toString('base64');
  return `Relaynet-Countersignature ${countersignatureBase64}`;
}
