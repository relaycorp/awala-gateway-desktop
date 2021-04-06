// tslint:disable:max-classes-per-file

import { ParcelCollection, PrivateNodeRegistration } from '@relaycorp/relaynet-core';
import {
  CallArgs,
  CollectParcelsArgs,
  DeliverParcelArgs,
  PreRegisterNodeArgs,
  RegisterNodeArgs,
} from './args';

export class MockMethodCall<CallArguments extends CallArgs, ResultType> {
  // tslint:disable-next-line:readonly-keyword
  public _wasCalled = false;
  // tslint:disable-next-line:readonly-keyword
  private args: CallArguments | undefined = undefined;

  private readonly error: Error | null = null;
  private readonly result: ResultType | undefined = undefined;

  constructor(result: ResultType);
  constructor(error: Error);
  constructor(output: ResultType | Error) {
    if (output instanceof Error) {
      this.error = output;
    } else {
      this.result = output;
    }
  }

  public get wasCalled(): boolean {
    return this._wasCalled;
  }

  public get arguments(): CallArguments | undefined {
    return this.args;
  }

  public call(args: CallArguments): ResultType {
    if (this._wasCalled) {
      throw new Error('Method was already called');
    }

    // tslint:disable-next-line:no-object-mutation
    this._wasCalled = true;
    // tslint:disable-next-line:no-object-mutation
    this.args = args;
    if (this.error) {
      throw this.error;
    }
    return this.result!!;
  }
}

export class PreRegisterNodeCall extends MockMethodCall<PreRegisterNodeArgs, ArrayBuffer> {}

export class RegisterNodeCall extends MockMethodCall<RegisterNodeArgs, PrivateNodeRegistration> {}

export class DeliverParcelCall extends MockMethodCall<DeliverParcelArgs, void> {}

export class CollectParcelsCall extends MockMethodCall<
  CollectParcelsArgs,
  AsyncIterable<ParcelCollection>
> {}
