import fg from 'fast-glob';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, ToolDefinition } from '../types.js';

const MAX_RESULTS = 500;

const definition: ToolDefinition = {
  name: 'Glob',
  description: 'Find files matching a glob pattern, sorted by most recently modified.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match files' },
      path: { type: 'string', description: 'Directory to search in (default: working dir)' },
    },
    required: ['pattern'],
  },
};

async function execute(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const pattern = input.pattern as string;
    const cwd = input.path
      ? path.resolve(ctx.workingDir, input.path as string)
      : ctx.workingDir;

    const entries = await fg(pattern, {
      cwd,
      dot: true,
      absolute: false,
      onlyFiles: true,
    });

    // Sort by mtime (most recent first)
    const withStats = await Promise.all(
      entries.map(async (entry) => {
        try {
          const stat = await fs.stat(path.join(cwd, entry));
          return { entry, mtime: stat.mtimeMs };
        } catch {
          return { entry, mtime: 0 };
        }
      }),
    );
    withStats.sort((a, b) => b.mtime - a.mtime);

    const truncated = withStats.length > MAX_RESULTS;
    const results = withStats.slice(0, MAX_RESULTS).map((w) => w.entry);

    let output = results.join('\n');
    if (truncated) {
      output += `\n… (truncated, showing ${MAX_RESULTS} of ${withStats.length} results)`;
    }

    return { content: output || 'No files matched', is_error: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${msg}`, is_error: true };
  }
}

export const globTool: Tool = { definition, execute };
