export function getBearerTokenFromAuthHeader(authorizationHeader?: string): string | null {
  const headerSanitized = authorizationHeader ?? '';
  const [type, value] = headerSanitized.split(' ', 2);
  const isBearer = type === 'Bearer';
  return isBearer ? value ?? null : null;
}
