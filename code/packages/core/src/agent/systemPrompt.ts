import type { ToolDefinition } from '../types.js';

export interface SystemPromptOptions {
  workingDir: string;
  tools: ToolDefinition[];
  extra?: string;
}

const BEHAVIORAL_RULES = `
## Core Behavioral Rules

1. **Read-before-Edit**: Always read a file before editing it. Never modify a file you have not read in the current session.
2. **Think before acting**: Use Think/thinking for complex multi-step reasoning before acting. Plan your approach before making changes.
3. **Prefer targeted tool calls over broad ones**: Use specific file paths, patterns, and scopes. Avoid scanning entire directory trees when you know what you need.
4. **Never truncate file content when writing**: When using the Write tool, always write the complete file content. Never use ellipsis or comments like "rest of file unchanged".
5. **Confirm destructive operations before executing**: Before running commands that delete files, drop data, or make irreversible changes, explain what you intend to do and why.
6. **Keep responses concise; use tools instead of explaining what you would do**: Act directly. Do not describe what you would do — just do it with the appropriate tool.
7. **Respect the working directory**: Do not access paths outside the working directory unless explicitly instructed. All file operations should be relative to or within the working directory.
`.trim();

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const parts: string[] = [];

  parts.push('You are AngyCode, an AI coding assistant.');
  parts.push(`Working directory: ${options.workingDir}`);
  parts.push(`Current date: ${new Date().toISOString().split('T')[0]}`);

  parts.push('');
  parts.push(BEHAVIORAL_RULES);

  if (options.tools.length > 0) {
    parts.push('');
    parts.push('Available tools:');
    for (const tool of options.tools) {
      parts.push(`- ${tool.name}: ${tool.description}`);
    }
  }

  if (options.extra) {
    parts.push('');
    parts.push(options.extra);
  }

  return parts.join('\n');
}
