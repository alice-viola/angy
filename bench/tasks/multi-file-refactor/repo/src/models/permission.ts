export interface Permission {
  id: string;
  roleId: string;
  resource: string;
  action: 'read' | 'write' | 'delete';
}

export function hasPermission(permissions: Permission[], resource: string, action: Permission['action']): boolean {
  return permissions.some(p => p.resource === resource && p.action === action);
}
