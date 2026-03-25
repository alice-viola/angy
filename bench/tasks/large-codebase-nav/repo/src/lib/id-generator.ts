import { randomUUID } from 'node:crypto';
export function generateId(): string {
  return randomUUID();
}
export function generateShortId(): string {
  return randomUUID().split('-')[0];
}
