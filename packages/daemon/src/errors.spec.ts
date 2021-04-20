import { PrivateGatewayError } from './errors';

test('.name should be taken from the name of the class', () => {
  class FooError extends PrivateGatewayError {}
  const error = new FooError('Winter is coming');
  expect(error.name).toBe('FooError');
});
