/** Summarize a tool call for display. */
export function summarizeTool(toolName: string, input: Record<string, any>): string {
  switch (toolName) {
    case 'Edit':
    case 'StrReplace':
    case 'Write':
    case 'Read':
      return input.file_path || input.path || 'file';
    case 'Bash':
      return (input.command || '').substring(0, 80);
    case 'Glob':
    case 'Grep':
      return input.pattern || '';
    case 'TodoWrite':
      return 'updating tasks';
    case 'Agent':
      return input.description || 'subagent';
    case 'AskUserQuestion':
    case 'mcp__c3p2-orchestrator__AskUserQuestion':
      return 'asking question';
    default:
      return toolName;
  }
}
