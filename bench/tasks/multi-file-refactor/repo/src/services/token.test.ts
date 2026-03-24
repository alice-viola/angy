import { describe, it, expect } from 'vitest';
import { generateToken, validateToken } from './token.js';

describe('token service', () => {
  it('generates a valid JWT-format token', () => {
    const token = generateToken('user-1');
    expect(token.split('.')).toHaveLength(3);
  });

  it('validates a generated token', () => {
    const token = generateToken('user-1');
    const result = validateToken(token);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe('user-1');
  });

  it('rejects a malformed token', () => {
    const result = validateToken('bad-token');
    expect(result.valid).toBe(false);
  });
});
