export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: string;
}

export const routes: Route[] = [
  { method: 'GET', path: '/health', handler: 'health.check' },
  { method: 'POST', path: '/auth/login', handler: 'session.create' },
  { method: 'GET', path: '/users', handler: 'user.list' },
];
