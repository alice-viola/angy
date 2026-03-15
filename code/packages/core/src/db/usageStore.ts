import type BetterSqlite3 from 'better-sqlite3';
import type { ProviderName } from '../types.js';

export interface UsageRecord {
  sessionId: string;
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export interface TotalUsageSummary extends UsageSummary {
  sessions: number;
}

export interface ToolExecution {
  id: number;
  sessionId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  isError: boolean;
  durationMs: number | null;
  createdAt: number;
}

interface ToolExecutionRow {
  id: number;
  session_id: string;
  tool_name: string;
  input: string;
  output: string | null;
  is_error: number;
  duration_ms: number | null;
  created_at: number;
}

export interface UsageStore {
  recordUsage(record: UsageRecord): void;
  getSessionUsage(sessionId: string): UsageSummary;
  getTotalUsage(since?: number): TotalUsageSummary;
  recordToolExecution(exec: {
    sessionId: string;
    toolName: string;
    input: unknown;
    output?: unknown;
    isError: boolean;
    durationMs?: number;
  }): void;
  getSessionToolExecutions(sessionId: string): ToolExecution[];
}

export function createUsageStore(db: BetterSqlite3.Database): UsageStore {
  const insertUsageStmt = db.prepare(`
    INSERT INTO usage (session_id, provider, model, input_tokens, output_tokens, cost_usd, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const sessionUsageStmt = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as total_input,
      COALESCE(SUM(output_tokens), 0) as total_output,
      COALESCE(SUM(cost_usd), 0) as total_cost
    FROM usage WHERE session_id = ?
  `);

  const insertToolExecStmt = db.prepare(`
    INSERT INTO tool_executions (session_id, tool_name, input, output, is_error, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const getToolExecsStmt = db.prepare(
    'SELECT * FROM tool_executions WHERE session_id = ? ORDER BY id ASC',
  );

  return {
    recordUsage(record) {
      insertUsageStmt.run(
        record.sessionId,
        record.provider,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.costUsd ?? null,
        Date.now(),
      );
    },

    getSessionUsage(sessionId) {
      const row = sessionUsageStmt.get(sessionId) as {
        total_input: number;
        total_output: number;
        total_cost: number;
      };
      return {
        totalInputTokens: row.total_input,
        totalOutputTokens: row.total_output,
        totalCostUsd: row.total_cost,
      };
    },

    getTotalUsage(since?: number) {
      let query = `
        SELECT
          COALESCE(SUM(input_tokens), 0) as total_input,
          COALESCE(SUM(output_tokens), 0) as total_output,
          COALESCE(SUM(cost_usd), 0) as total_cost,
          COUNT(DISTINCT session_id) as sessions
        FROM usage
      `;
      const params: unknown[] = [];
      if (since !== undefined) {
        query += ' WHERE created_at >= ?';
        params.push(since);
      }

      const row = db.prepare(query).get(...params) as {
        total_input: number;
        total_output: number;
        total_cost: number;
        sessions: number;
      };
      return {
        totalInputTokens: row.total_input,
        totalOutputTokens: row.total_output,
        totalCostUsd: row.total_cost,
        sessions: row.sessions,
      };
    },

    recordToolExecution(exec) {
      insertToolExecStmt.run(
        exec.sessionId,
        exec.toolName,
        JSON.stringify(exec.input),
        exec.output !== undefined ? JSON.stringify(exec.output) : null,
        exec.isError ? 1 : 0,
        exec.durationMs ?? null,
        Date.now(),
      );
    },

    getSessionToolExecutions(sessionId) {
      const rows = getToolExecsStmt.all(sessionId) as ToolExecutionRow[];
      return rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        toolName: row.tool_name,
        input: JSON.parse(row.input) as unknown,
        output: row.output ? (JSON.parse(row.output) as unknown) : null,
        isError: row.is_error === 1,
        durationMs: row.duration_ms,
        createdAt: row.created_at,
      }));
    },
  };
}
