import { describe, it, expect } from 'vitest';
import { authRoutes } from './auth.js';

describe('auth routes', () => {
  it('exports auth route definitions', () => {
    expect(authRoutes).toBeDefined();
    expect(authRoutes.length).toBeGreaterThan(0);
  });

  it('login route does not require auth', () => {
    const login = authRoutes.find(r => r.path === '/auth/login');
    expect(login?.requiresAuth).toBe(false);
  });
});
