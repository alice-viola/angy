import { findUserById } from '../services/user-service.js';

export function getUser(id: string): { status: number; body: unknown } {
  const user = findUserById(id);
  if (!user) return { status: 404, body: { error: 'User not found' } };
  return { status: 200, body: { id: user.id, email: user.email, name: user.name } };
}
