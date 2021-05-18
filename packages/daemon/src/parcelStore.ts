// tslint:disable:max-classes-per-file

import { Service } from 'typedi';

import { PrivateGatewayError } from './errors';

@Service()
export class ParcelStore {
  public async storeInternetBoundParcel(_parcelSerialized: ArrayBuffer): Promise<void> {
    throw new Error('implement');
  }
}

export class MalformedParcelError extends PrivateGatewayError {}

export class InvalidParcelError extends PrivateGatewayError {}
