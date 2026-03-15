import { spawn } from 'node:child_process';
import type { Tool, ToolContext, ToolResult, ToolDefinition } from '../types.js';

const MAX_STDOUT = 100_000;
const MAX_STDERR = 10_000;
const DEFAULT_TIMEOUT = 120_000;

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '\n… (truncated)';
}

const definition: ToolDefinition = {
  name: 'Bash',
  description: 'Execute a shell command and return its output.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000)' },
      description: { type: 'string', description: 'Human-readable description of what this command does' },
    },
    required: ['command'],
  },
};

async function execute(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const command = input.command as string;
    const timeout = (input.timeout as number) ?? DEFAULT_TIMEOUT;

    return await new Promise<ToolResult>((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const proc = spawn('sh', ['-c', command], {
        cwd: ctx.workingDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
      }, timeout);

      proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ content: `Error: ${err.message}`, is_error: true });
      });

      proc.on('close', (code, signal) => {
        clearTimeout(timer);
        const exitCode = signal === 'SIGKILL' ? -1 : (code ?? 1);
        const stdout = truncate(Buffer.concat(stdoutChunks).toString('utf-8'), MAX_STDOUT);
        const stderr = truncate(Buffer.concat(stderrChunks).toString('utf-8'), MAX_STDERR);

        const content = `<stdout>${stdout}</stdout><stderr>${stderr}</stderr><exit_code>${exitCode}</exit_code>`;
        resolve({ content, is_error: exitCode !== 0 });
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${msg}`, is_error: true };
  }
}

export const bashTool: Tool = { definition, execute };
