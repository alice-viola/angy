export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
}
