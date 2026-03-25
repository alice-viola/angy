export const TEST_USER_ID = 'test-user-001';
export const TEST_ADMIN_ID = 'test-admin-001';
export function createMockRequest(overrides?: Record<string, unknown>): Record<string, unknown> {
  return { headers: {}, body: {}, params: {}, ...overrides };
}
