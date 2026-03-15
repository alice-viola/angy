import { DatabaseImpl, createUsageStore } from '@angycode/core';

export interface CostOptions {
  session?: string;
  since?: string;
  json?: boolean;
}

export function costCommand(opts: CostOptions): void {
  const db = new DatabaseImpl();
  try {
    const store = createUsageStore(db.db);

    if (opts.session) {
      const usage = store.getSessionUsage(opts.session);
      if (opts.json) {
        process.stdout.write(JSON.stringify(usage, null, 2) + '\n');
      } else {
        process.stdout.write(`Session: ${opts.session}\n`);
        process.stdout.write(`  Input tokens:  ${usage.totalInputTokens}\n`);
        process.stdout.write(`  Output tokens: ${usage.totalOutputTokens}\n`);
        process.stdout.write(`  Cost:          $${usage.totalCostUsd.toFixed(4)}\n`);
      }
      return;
    }

    const since = opts.since ? parseSince(opts.since) : undefined;
    const usage = store.getTotalUsage(since);

    if (opts.json) {
      process.stdout.write(JSON.stringify(usage, null, 2) + '\n');
    } else {
      process.stdout.write(`Total usage${since ? ` (since ${opts.since})` : ''}:\n`);
      process.stdout.write(`  Sessions:      ${usage.sessions}\n`);
      process.stdout.write(`  Input tokens:  ${usage.totalInputTokens}\n`);
      process.stdout.write(`  Output tokens: ${usage.totalOutputTokens}\n`);
      process.stdout.write(`  Cost:          $${usage.totalCostUsd.toFixed(4)}\n`);
    }
  } finally {
    db.close();
  }
}

function parseSince(value: string): number {
  const now = Date.now();
  const match = value.match(/^(\d+)([dhm])$/);
  if (match) {
    const n = parseInt(match[1]!, 10);
    const unit = match[2]!;
    const ms = unit === 'd' ? n * 86400000 : unit === 'h' ? n * 3600000 : n * 60000;
    return now - ms;
  }
  // Try as ISO date
  const ts = Date.parse(value);
  if (!isNaN(ts)) return ts;
  throw new Error(`Invalid --since value: ${value}. Use e.g. "7d", "24h", or "2025-01-01".`);
}
