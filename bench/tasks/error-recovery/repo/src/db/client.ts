import type { User } from '../types/user.js';

// Simulated database rows (as they come from the DB)
const dbRows = [
  { user_id: 1, user_name: 'Alice', user_email: 'alice@example.com' },
  { user_id: 2, user_name: 'Bob', user_email: 'bob@example.com' },
  { user_id: 3, user_name: 'Charlie', user_email: 'charlie@example.com' },
];

/**
 * Find a user by their ID.
 * @returns A User object with { id, name, email }
 */
export function findUserById(id: number): User | undefined {
  const row = dbRows.find(r => r.user_id === id);
  if (!row) return undefined;
  // BUG: returns raw DB row without mapping to User interface
  return row as unknown as User;
}

/**
 * Get all users.
 * @returns Array of User objects
 */
export function findAllUsers(): User[] {
  // BUG: same issue — returns raw rows without mapping
  return dbRows as unknown as User[];
}
