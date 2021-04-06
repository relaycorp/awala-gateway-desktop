import { BindingType, PublicNodeAddress, resolvePublicAddress } from '@relaycorp/relaynet-core';
import { PoWebClient } from '@relaycorp/relaynet-poweb';

import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { getMockInstance, mockSpy } from '../../testUtils/jest';
import { getPromiseRejection } from '../../testUtils/promises';
import {makeGSCClient, NonExistingAddressError} from './gscClient';

jest.mock('@relaycorp/relaynet-core', () => {
  const actualModule = jest.requireActual('@relaycorp/relaynet-core');
  return {
    ...actualModule,
    resolvePublicAddress: jest.fn(),
  };
});

const mockPoWebClient = {};
const mockPoWebInitRemote = mockSpy(jest.spyOn(PoWebClient, 'initRemote'), () => mockPoWebClient);

describe('makeGSCClient', () => {
  test('PublicAddressingError should be thrown if address does not exist', async () => {
    const error = await getPromiseRejection(
      makeGSCClient(DEFAULT_PUBLIC_GATEWAY),
      NonExistingAddressError,
    );

    expect(error.message).toEqual(`${DEFAULT_PUBLIC_GATEWAY} does not have a GSC record`);
    expect(error.cause()).toBeUndefined();
  });

  test('PoWeb client should be bound to resolved host/port', async () => {
    const powebAddress: PublicNodeAddress = {
      host: 'poweb.example.com',
      port: 123,
    };
    getMockInstance(resolvePublicAddress).mockResolvedValue(powebAddress);

    const client = await makeGSCClient(DEFAULT_PUBLIC_GATEWAY);

    expect(resolvePublicAddress).toBeCalledWith(DEFAULT_PUBLIC_GATEWAY, BindingType.GSC);
    expect(mockPoWebInitRemote).toBeCalledWith(powebAddress.host, powebAddress.port);
    expect(client).toBe(mockPoWebClient);
  });
});
