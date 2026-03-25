import { findUserById, findAllUsers } from '../db/client.js';

export function getUserDisplay(id: number): string {
  const user = findUserById(id);
  if (!user) return 'Unknown user';
  return `${user.name} <${user.email}>`;
}

export function getUserIds(): number[] {
  return findAllUsers().map(u => u.id);
}

export function getUserEmail(id: number): string | undefined {
  const user = findUserById(id);
  return user?.email;
}
