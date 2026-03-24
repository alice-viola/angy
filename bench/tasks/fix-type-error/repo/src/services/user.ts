import type { User } from '../types/user.js';

export function getUser(id: number): string {
  return { id, name: 'Alice', email: 'alice@example.com' };
}
