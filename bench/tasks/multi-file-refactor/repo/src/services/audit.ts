export interface AuditEntry {
  action: string;
  userId: string;
  timestamp: Date;
  details?: string;
}

const auditLog: AuditEntry[] = [];

export function logAudit(action: string, userId: string, details?: string): void {
  auditLog.push({ action, userId, timestamp: new Date(), details });
}

export function getAuditLog(): AuditEntry[] {
  return [...auditLog];
}
