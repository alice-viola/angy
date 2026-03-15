import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, ToolDefinition } from '../types.js';

const MAX_OUTPUT = 50_000;

const definition: ToolDefinition = {
  name: 'Grep',
  description: 'Search file contents for a regex pattern.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'File or directory to search (default: working dir)' },
      recursive: { type: 'boolean', description: 'Search recursively (default: true)' },
      glob: { type: 'string', description: 'File glob pattern to restrict which files are searched' },
      output_mode: { type: 'string', description: 'Output format: content, files_with_matches, or count', enum: ['content', 'files_with_matches', 'count'] },
      context_lines: { type: 'number', description: 'Number of context lines before and after each match (-C)' },
      case_insensitive: { type: 'boolean', description: 'Case-insensitive matching (-i)' },
      head_limit: { type: 'number', description: 'Max number of result lines to return' },
    },
    required: ['pattern'],
  },
};

function isRgAvailable(): boolean {
  try {
    execSync('which rg', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '\n… (truncated)';
}

interface GrepOptions {
  recursive: boolean;
  glob?: string;
  outputMode?: string;
  contextLines?: number;
  caseInsensitive?: boolean;
  headLimit?: number;
}

async function grepWithRg(
  pattern: string,
  searchPath: string,
  cwd: string,
  opts: GrepOptions,
): Promise<string> {
  return new Promise((resolve) => {
    const args = ['--color=never', '-n'];
    if (!opts.recursive) args.push('--no-recursive');
    if (opts.caseInsensitive) args.push('-i');
    if (opts.contextLines !== undefined) args.push('-C', String(opts.contextLines));
    if (opts.glob) args.push('--glob', opts.glob);

    if (opts.outputMode === 'files_with_matches') {
      args.push('--files-with-matches');
    } else if (opts.outputMode === 'count') {
      args.push('--count');
    }

    args.push(pattern, searchPath);

    const proc = spawn('rg', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));

    proc.on('error', () => resolve(''));
    proc.on('close', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
  });
}

async function grepWithNode(
  pattern: string,
  searchPath: string,
  cwd: string,
  opts: GrepOptions,
): Promise<string> {
  const fullPath = path.resolve(cwd, searchPath);
  const flags = opts.caseInsensitive ? 'i' : '';
  const regex = new RegExp(pattern, flags);
  const results: string[] = [];

  async function scanFile(filePath: string) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(cwd, filePath);

      if (opts.outputMode === 'files_with_matches') {
        for (const line of lines) {
          if (regex.test(line)) {
            results.push(relPath);
            return;
          }
        }
        return;
      }

      const matchingIndices: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matchingIndices.push(i);
        }
      }

      if (opts.outputMode === 'count') {
        if (matchingIndices.length > 0) {
          results.push(`${relPath}:${matchingIndices.length}`);
        }
        return;
      }

      // content mode (default)
      const ctx = opts.contextLines ?? 0;
      const outputLines = new Set<number>();
      for (const idx of matchingIndices) {
        for (let j = Math.max(0, idx - ctx); j <= Math.min(lines.length - 1, idx + ctx); j++) {
          outputLines.add(j);
        }
      }

      const sorted = [...outputLines].sort((a, b) => a - b);
      for (const i of sorted) {
        results.push(`${relPath}:${i + 1}:${lines[i]}`);
      }
    } catch {
      // skip unreadable files
    }
  }

  async function scanDir(dirPath: string) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory() && opts.recursive) {
          await scanDir(full);
        } else if (entry.isFile()) {
          // If glob is set, do a simple check
          if (opts.glob && !matchesGlob(entry.name, opts.glob)) continue;
          await scanFile(full);
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }

  try {
    const stat = await fs.stat(fullPath);
    if (stat.isFile()) {
      await scanFile(fullPath);
    } else if (stat.isDirectory()) {
      await scanDir(fullPath);
    }
  } catch {
    // path doesn't exist
  }

  return results.join('\n');
}

/** Simple glob match for the Node fallback (supports *.ext patterns) */
function matchesGlob(filename: string, glob: string): boolean {
  // Convert simple glob to regex: *.ts -> /\.ts$/
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(filename);
}

async function execute(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const pattern = input.pattern as string;
    const searchPath = (input.path as string) ?? '.';
    const recursive = (input.recursive as boolean) ?? true;
    const glob = input.glob as string | undefined;
    const outputMode = input.output_mode as string | undefined;
    const contextLines = input.context_lines as number | undefined;
    const caseInsensitive = (input.case_insensitive as boolean) ?? false;
    const headLimit = input.head_limit as number | undefined;

    const opts: GrepOptions = {
      recursive,
      glob,
      outputMode,
      contextLines,
      caseInsensitive,
      headLimit,
    };

    let output: string;
    if (isRgAvailable()) {
      output = await grepWithRg(pattern, searchPath, ctx.workingDir, opts);
    } else {
      output = await grepWithNode(pattern, searchPath, ctx.workingDir, opts);
    }

    output = output.trim();

    // Apply head_limit
    if (headLimit !== undefined && headLimit > 0) {
      const lines = output.split('\n');
      if (lines.length > headLimit) {
        output = lines.slice(0, headLimit).join('\n');
      }
    }

    output = truncate(output, MAX_OUTPUT);
    return { content: output || 'No matches found', is_error: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${msg}`, is_error: true };
  }
}

export const grepTool: Tool = { definition, execute };
