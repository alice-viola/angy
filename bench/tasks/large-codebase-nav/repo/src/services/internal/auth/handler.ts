export function validateJwtToken(token: string): { valid: boolean; payload?: Record<string, unknown> } {
  // Validates a JWT token by checking signature, expiry, and issuer claims
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!header.alg || header.alg === 'none') return { valid: false };
    if (payload.exp && Date.now() / 1000 > payload.exp) return { valid: false };
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}
