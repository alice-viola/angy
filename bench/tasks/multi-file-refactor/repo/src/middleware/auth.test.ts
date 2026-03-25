import { describe, it, expect } from 'vitest';
import { authMiddleware } from './auth.js';

describe('authMiddleware', () => {
  it('rejects request without authorization header', () => {
    const result = authMiddleware({ headers: {} });
    expect(result.authenticated).toBe(false);
  });

  it('rejects request with invalid token format', () => {
    const result = authMiddleware({ headers: { authorization: 'Bearer invalid' } });
    expect(result.authenticated).toBe(false);
  });
});
