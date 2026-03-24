export interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  token?: string;
}
