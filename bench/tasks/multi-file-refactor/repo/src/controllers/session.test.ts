import { describe, it, expect } from 'vitest';
import { createSession, validateSession } from './session.js';

describe('session controller', () => {
  it('creates a session with a token', () => {
    const session = createSession('user-1');
    expect(session.token).toBeDefined();
    expect(typeof session.token).toBe('string');
    expect(session.token.split('.')).toHaveLength(3);
  });

  it('validates a created session token', () => {
    const { token } = createSession('user-1');
    const result = validateSession(token);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe('user-1');
  });

  it('rejects an invalid token', () => {
    const result = validateSession('not.valid');
    expect(result.valid).toBe(false);
  });
});
