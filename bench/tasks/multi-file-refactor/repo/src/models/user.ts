export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
}

export function createUser(email: string, name: string, passwordHash: string): User {
  return { id: crypto.randomUUID(), email, name, passwordHash, createdAt: new Date() };
}
