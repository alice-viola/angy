const JWT_SECRET = 'app-secret-key';

function verifyToken(token: string): { valid: boolean; userId?: string } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return { valid: false };
    return { valid: true, userId: payload.sub };
  } catch {
    return { valid: false };
  }
}

export function authMiddleware(req: { headers: Record<string, string> }): { authenticated: boolean; userId?: string } {
  const authHeader = req.headers['authorization'] ?? '';
  if (!authHeader.startsWith('Bearer ')) return { authenticated: false };
  const token = authHeader.slice(7);
  const result = verifyToken(token);
  return { authenticated: result.valid, userId: result.userId };
}
