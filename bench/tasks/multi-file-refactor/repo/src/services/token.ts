const TOKEN_SECRET = 'app-secret-key';

export function generateToken(userId: string, expiresInSeconds = 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  })).toString('base64url');
  const signature = Buffer.from(`${header}.${payload}.${TOKEN_SECRET}`).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

export function validateToken(token: string): { valid: boolean; userId?: string; expiresAt?: number } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return { valid: false };
    return { valid: true, userId: payload.sub, expiresAt: payload.exp };
  } catch {
    return { valid: false };
  }
}
