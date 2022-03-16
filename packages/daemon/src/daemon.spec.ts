import { addSeconds } from 'date-fns';
import { getRepository } from 'typeorm';

import daemon from './daemon';
import { ParcelCollection } from './entity/ParcelCollection';
import { makeServer, runServer } from './server';
import startup from './startup';
import runSync from './sync';
import { setUpTestDBConnection } from './testUtils/db';
import { mockLoggerToken } from './testUtils/logging';
import { Container } from 'typedi';
import { PrivateGatewayManager } from './PrivateGatewayManager';

jest.mock('./server');
jest.mock('./sync');
jest.mock('./startup');

setUpTestDBConnection();
mockLoggerToken();

test('Startup routine should be called', async () => {
  await daemon();

  expect(startup).toBeCalledWith('daemon');
});

test('Gateway should be created if it does not exist yet', async () => {
  await daemon();

  const gatewayManager = Container.get(PrivateGatewayManager);
  await gatewayManager.getCurrent();
});

test('Server should be run', async () => {
  await daemon();

  expect(makeServer).toBeCalledWith();
  expect(runServer).toHaveBeenCalledAfter(startup as any);
});

test('Sync should be run', async () => {
  await daemon();

  expect(runSync).toHaveBeenCalledAfter(startup as any);
});

test('Expired parcel collections should be removed', async () => {
  const now = new Date();
  const parcelCollectionACKRepo = getRepository(ParcelCollection);
  const expiredACK = parcelCollectionACKRepo.create({
    parcelExpiryDate: now,
    parcelId: 'foo',
    recipientEndpointAddress: 'foo',
    senderEndpointPrivateAddress: 'foo',
  });
  const validACK = parcelCollectionACKRepo.create({
    parcelExpiryDate: addSeconds(now, 5),
    parcelId: 'bar',
    recipientEndpointAddress: 'bar',
    senderEndpointPrivateAddress: 'bar',
  });
  await parcelCollectionACKRepo.save([expiredACK, validACK]);
  await expect(parcelCollectionACKRepo.count()).resolves.toEqual(2);

  await daemon();

  const [[ack], ackCount] = await parcelCollectionACKRepo.findAndCount();
  expect(ackCount).toEqual(1);
  expect(ack.parcelId).toEqual(validACK.parcelId);
});
