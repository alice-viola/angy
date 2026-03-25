export interface AuthContext {
  userId: string;
  roles: string[];
  sessionId: string;
}
export type Permission = 'read' | 'write' | 'admin';
