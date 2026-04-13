import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, ToolDefinition } from '../types.js';

const definition: ToolDefinition = {
  name: 'Write',
  description: 'Write content to a file. Creates parent directories if needed.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['file_path', 'content'],
  },
};

async function execute(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    if (!input.file_path || typeof input.file_path !== 'string') {
      return { content: 'Error: file_path is required (e.g. "index.html")', is_error: true };
    }
    if (input.content === undefined || input.content === null) {
      return { content: 'Error: content is required', is_error: true };
    }
    const filePath = path.resolve(ctx.workingDir, input.file_path as string);
    const content = String(input.content);

    // filesRead guard: if file exists, must have been read first
    let fileExists = false;
    try {
      await fs.access(filePath);
      fileExists = true;
    } catch {
      // file does not exist — ok to write
    }

    if (fileExists && !ctx.filesRead.has(filePath)) {
      return {
        content: 'Error: Must read file before writing to it',
        is_error: true,
      };
    }

    // Create parent directories
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Atomic write: write to tmp, then rename
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);

    ctx.filesRead.add(filePath);
    return { content: `Wrote ${content.length} bytes to ${filePath}`, is_error: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${msg}`, is_error: true };
  }
}

export const writeTool: Tool = { definition, execute };
