import { BindingType, PublicNodeAddress, resolveInternetAddress } from '@relaycorp/relaynet-core';
import { PoWebClient } from '@relaycorp/relaynet-poweb';

import { DEFAULT_INTERNET_GATEWAY_ADDRESS } from '../../constants';
import { getMockInstance, mockSpy } from '../../testUtils/jest';
import { getPromiseRejection } from '../../testUtils/promises';
import { makeGSCClient } from './gscClient';
import { NonExistingAddressError } from './errors';

jest.mock('@relaycorp/relaynet-core', () => {
  const actualModule = jest.requireActual('@relaycorp/relaynet-core');
  return {
    ...actualModule,
    resolveInternetAddress: jest.fn(),
  };
});

const mockPoWebClient = {};
const mockPoWebInitRemote = mockSpy(jest.spyOn(PoWebClient, 'initRemote'), () => mockPoWebClient);

describe('makeGSCClient', () => {
  test('NonExistingAddressError should be thrown if address does not exist', async () => {
    const error = await getPromiseRejection(
      makeGSCClient(DEFAULT_INTERNET_GATEWAY_ADDRESS),
      NonExistingAddressError,
    );

    expect(error.message).toEqual(`${DEFAULT_INTERNET_GATEWAY_ADDRESS} does not have a GSC record`);
    expect(error.cause()).toBeUndefined();
  });

  test('PoWeb client should be bound to resolved host/port', async () => {
    const powebAddress: PublicNodeAddress = {
      host: 'poweb.example.com',
      port: 123,
    };
    getMockInstance(resolveInternetAddress).mockResolvedValue(powebAddress);

    const client = await makeGSCClient(DEFAULT_INTERNET_GATEWAY_ADDRESS);

    expect(resolveInternetAddress).toBeCalledWith(
      DEFAULT_INTERNET_GATEWAY_ADDRESS,
      BindingType.GSC,
    );
    expect(mockPoWebInitRemote).toBeCalledWith(powebAddress.host, powebAddress.port);
    expect(client).toBe(mockPoWebClient);
  });
});
