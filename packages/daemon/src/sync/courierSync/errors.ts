// tslint:disable:max-classes-per-file

import { PrivateGatewayError } from '../../errors';

export abstract class CourierSyncError extends PrivateGatewayError {}

export class DisconnectedFromCourierError extends CourierSyncError {}

export class UnregisteredGatewayError extends CourierSyncError {}
