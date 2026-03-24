export interface MigrationRecord { id: number; name: string; appliedAt: Date; }
export interface PoolStats { active: number; idle: number; waiting: number; }
