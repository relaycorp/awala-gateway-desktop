import { getBearerTokenFromAuthHeader } from './auth';

describe('getBearerTokenFromAuthHeader', () => {
  test('Missing header should return null', () => {
    expect(getBearerTokenFromAuthHeader(undefined)).toEqual(null);
  });

  test('Non-bearer token should return null', () => {
    expect(getBearerTokenFromAuthHeader('Foo token')).toEqual(null);
  });

  test('Malformed token should return null', () => {
    expect(getBearerTokenFromAuthHeader('token')).toEqual(null);
  });

  test('Well-formed Bearer token should be returned', () => {
    const token = 'the-token';
    expect(getBearerTokenFromAuthHeader(`Bearer ${token}`)).toEqual(token);
  });
});
