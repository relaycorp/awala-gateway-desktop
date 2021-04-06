import { BindingType, GSCClient, resolvePublicAddress } from '@relaycorp/relaynet-core';
import { PoWebClient } from '@relaycorp/relaynet-poweb';

import { PrivateGatewayError } from '../../errors';

export class NonExistingAddressError extends PrivateGatewayError {}

/**
 * Result the PoWeb address and return a client bound to it.
 *
 * @param publicGatewayAddress
 * @throws PublicAddressingError if the DNS lookup or DNSSEC verification failed
 * @throws NonExistingAddressError if the DNS+DNSSEC lookup succeeded but the address doesn't exist
 */
export async function makeGSCClient(publicGatewayAddress: string): Promise<GSCClient> {
  const address = await resolvePublicAddress(publicGatewayAddress, BindingType.GSC);
  if (!address) {
    throw new NonExistingAddressError(`${publicGatewayAddress} does not have a GSC record`);
  }
  return PoWebClient.initRemote(address.host, address.port);
}
