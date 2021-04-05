import { createHash } from 'crypto';

export function sha256Hex(plaintext: Buffer): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
