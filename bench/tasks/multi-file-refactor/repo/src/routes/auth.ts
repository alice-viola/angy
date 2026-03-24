export interface AuthRoute {
  path: string;
  requiresAuth: boolean;
}

export const authRoutes: AuthRoute[] = [
  { path: '/auth/login', requiresAuth: false },
  { path: '/auth/logout', requiresAuth: true },
  { path: '/auth/refresh', requiresAuth: true },
];
