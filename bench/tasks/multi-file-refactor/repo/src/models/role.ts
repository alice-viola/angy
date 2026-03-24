export interface Role {
  id: string;
  name: string;
  description: string;
}

export const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  GUEST: 'guest',
} as const;
