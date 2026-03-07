import { Command } from '@tauri-apps/plugin-shell';
import { homeDir } from '@tauri-apps/api/path';
import { writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { useEpicStore } from '../stores/epics';
import { getDatabase } from '../stores/sessions';
import type { PriorityHint, ComplexityEstimate } from '../engine/KosTypes';

interface EpicAnalysis {
  title: string;
  description: string;
  acceptanceCriteria: string;
  priorityHint: PriorityHint;
  complexity: ComplexityEstimate;
}

async function resolveClaudeBinary(): Promise<string> {
  const home = (await homeDir()).replace(/\/+$/, '');
  const candidates = [
    `${home}/.local/bin/claude`,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const candidate of candidates) {
    try {
      if (await exists(candidate)) return candidate;
    } catch { /* ignore */ }
  }
  return 'claude';
}

export async function transformChatToEpic(sessionId: string, projectId: string): Promise<string> {
  const db = getDatabase();
  const [messages, session] = await Promise.all([
    db.loadMessages(sessionId),
    db.loadSession(sessionId),
  ]);
  const chatTitle = session?.title ?? 'Untitled Chat';

  const convo = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(0, 60)
    .map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${role}: ${content.slice(0, 2000)}`;
    })
    .join('\n\n');

  const prompt = `You are analyzing a software engineering chat conversation to define an epic (a work item).

CHAT TITLE: ${chatTitle}

CONVERSATION:
${convo}

Based on the conversation, create a well-defined epic. Return ONLY a valid JSON object with these exact fields (no markdown, no code fences, no explanation):
{
  "title": "<concise epic title, max 60 chars>",
  "description": "<2-4 sentences describing what needs to be built>",
  "acceptanceCriteria": "<bullet list, each criterion on its own line starting with - >",
  "priorityHint": "<one of: critical, high, medium, low, none>",
  "complexity": "<one of: trivial, small, medium, large, epic>"
}`;

  const promptFile = `/tmp/angy-epic-${Date.now()}.txt`;
  await writeTextFile(promptFile, prompt);

  const claudeBin = await resolveClaudeBinary();
  const command = Command.create('exec-sh', [
    '-c',
    `"${claudeBin}" -p --output-format json < "${promptFile}"`,
  ]);
  const output = await command.execute();

  if (output.code !== 0) {
    throw new Error(`Claude exited with code ${output.code}: ${output.stderr || 'unknown error'}`);
  }

  let epicData: EpicAnalysis;
  try {
    const wrapper = JSON.parse(output.stdout);
    const text: string = wrapper.result ?? output.stdout;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    epicData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Could not parse Claude response: ${e}`);
  }

  const epicStore = useEpicStore();
  const epic = await epicStore.createEpic(projectId, epicData.title, {
    description: epicData.description,
    acceptanceCriteria: epicData.acceptanceCriteria,
    priorityHint: epicData.priorityHint,
    complexity: epicData.complexity,
  });

  return epic.id;
}
