export const userRoutes = [
  { method: 'GET' as const, path: '/users', handler: 'listUsers' },
  { method: 'GET' as const, path: '/users/:id', handler: 'getUser' },
  { method: 'PUT' as const, path: '/users/:id', handler: 'updateUser' },
];
