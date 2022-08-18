import { BindingType, GSCClient, resolveInternetAddress } from '@relaycorp/relaynet-core';
import { PoWebClient } from '@relaycorp/relaynet-poweb';

import { NonExistingAddressError } from './errors';

/**
 * Resolve the PoWeb address and return a client bound to it.
 *
 * @param internetGatewayAddress The Internet address of the Internet gateway
 * @throws UnreachableResolverError if DNS resolver is unreachable
 * @throws InternetAddressingError if the DNS lookup or DNSSEC verification failed
 * @throws NonExistingAddressError if the DNS+DNSSEC lookup succeeded but the address doesn't exist
 */
export async function makeGSCClient(internetGatewayAddress: string): Promise<GSCClient> {
  const address = await resolveInternetAddress(internetGatewayAddress, BindingType.GSC);
  if (!address) {
    throw new NonExistingAddressError(`${internetGatewayAddress} does not have a GSC record`);
  }
  return PoWebClient.initRemote(address.host, address.port);
}
