import type { User } from '../models/user.js';

const users: Map<string, User> = new Map();

export function findUserById(id: string): User | undefined {
  return users.get(id);
}

export function findUserByEmail(email: string): User | undefined {
  return [...users.values()].find(u => u.email === email);
}
