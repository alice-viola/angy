import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, ToolDefinition } from '../types.js';

const definition: ToolDefinition = {
  name: 'Edit',
  description: 'Replace text in a file. Supports single or replace_all mode.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to edit' },
      old_string: { type: 'string', description: 'The text to find and replace' },
      new_string: { type: 'string', description: 'The replacement text' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences (default false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
};

async function execute(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const filePath = path.resolve(ctx.workingDir, input.file_path as string);
    const oldString = input.old_string as string;
    const newString = input.new_string as string;
    const replaceAll = (input.replace_all as boolean) ?? false;

    // filesRead guard
    if (!ctx.filesRead.has(filePath)) {
      return { content: 'Error: Must read file before editing it', is_error: true };
    }

    const content = await fs.readFile(filePath, 'utf-8');

    // Check if old_string exists
    const parts = content.split(oldString);
    const occurrences = parts.length - 1;

    if (occurrences === 0) {
      return { content: 'Error: old_string not found in file', is_error: true };
    }

    // Uniqueness check for single replace
    if (!replaceAll && occurrences > 1) {
      return {
        content: `Error: old_string appears ${occurrences} times. Use replace_all: true or make old_string more specific`,
        is_error: true,
      };
    }

    // CRITICAL: Do NOT use String.replace/replaceAll — they interpret $ patterns
    // Use split/join which is safe for all input strings
    let result: string;
    if (replaceAll) {
      result = parts.join(newString);
    } else {
      // Single replace: rejoin all but first split with old_string, then join first + new + rest
      result = parts[0] + newString + parts.slice(1).join(oldString);
    }

    // Atomic write
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, result, 'utf-8');
    await fs.rename(tmpPath, filePath);

    const replaced = replaceAll ? occurrences : 1;
    return {
      content: `Replaced ${replaced} occurrence${replaced > 1 ? 's' : ''} in ${filePath}`,
      is_error: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${msg}`, is_error: true };
  }
}

export const editTool: Tool = { definition, execute };
