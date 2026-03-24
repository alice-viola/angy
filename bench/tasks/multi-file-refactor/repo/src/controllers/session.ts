const SECRET = 'app-secret-key';

function signToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const signature = Buffer.from(`${header}.${body}.${SECRET}`).toString('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token: string): { valid: boolean; payload?: Record<string, unknown> } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return { valid: false };
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

export function createSession(userId: string): { token: string } {
  const token = signToken({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 });
  return { token };
}

export function validateSession(token: string): { valid: boolean; userId?: string } {
  const result = verifyToken(token);
  return { valid: result.valid, userId: result.payload?.sub as string | undefined };
}
