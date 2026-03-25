import { describe, it, expect } from 'vitest';
import { createUser } from './user.js';

describe('user model', () => {
  it('creates a user with the given fields', () => {
    const user = createUser('test@example.com', 'Test User', 'hashed-pw');
    expect(user.email).toBe('test@example.com');
    expect(user.name).toBe('Test User');
    expect(user.id).toBeDefined();
  });
});
