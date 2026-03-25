import { createHash, randomBytes } from 'node:crypto';
export function hashSha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
export function generateNonce(size: number = 16): string {
  return randomBytes(size).toString('hex');
}
