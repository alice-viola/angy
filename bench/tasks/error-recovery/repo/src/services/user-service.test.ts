import { describe, it, expect } from 'vitest';
import { getUserDisplay, getUserIds, getUserEmail } from './user-service.js';

describe('user-service', () => {
  it('getUserDisplay returns formatted name and email', () => {
    expect(getUserDisplay(1)).toBe('Alice <alice@example.com>');
  });

  it('getUserDisplay returns Unknown for missing user', () => {
    expect(getUserDisplay(999)).toBe('Unknown user');
  });

  it('getUserIds returns array of numeric ids', () => {
    const ids = getUserIds();
    expect(ids).toEqual([1, 2, 3]);
  });

  it('getUserEmail returns email for existing user', () => {
    expect(getUserEmail(2)).toBe('bob@example.com');
  });

  it('getUserEmail returns undefined for missing user', () => {
    expect(getUserEmail(999)).toBeUndefined();
  });
});
