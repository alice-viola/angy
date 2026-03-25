import { describe, it, expect } from 'vitest';
import { getUser } from './user.js';

describe('getUser', () => {
  it('returns a user with the given id', () => {
    const user = getUser(1);
    expect(user).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
  });

  it('returns an object with id, name, and email properties', () => {
    const user = getUser(42);
    expect(user).toHaveProperty('id', 42);
    expect(user).toHaveProperty('name');
    expect(user).toHaveProperty('email');
  });
});
