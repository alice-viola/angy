export const sessionRoutes = [
  { method: 'POST' as const, path: '/sessions', handler: 'createSession' },
  { method: 'DELETE' as const, path: '/sessions/:id', handler: 'deleteSession' },
];
