export const adminRoutes = [
  { method: 'GET' as const, path: '/admin/audit', handler: 'getAuditEntries' },
  { method: 'GET' as const, path: '/admin/system', handler: 'getSystemInfo' },
];
