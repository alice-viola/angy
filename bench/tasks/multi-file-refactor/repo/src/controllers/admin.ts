import { getAuditLog } from '../services/audit.js';

export function getAuditEntries(): { status: number; body: unknown } {
  return { status: 200, body: getAuditLog() };
}

export function getSystemInfo(): { status: number; body: unknown } {
  return { status: 200, body: { version: '1.0.0', nodeVersion: process.version } };
}
