import { Command } from '@tauri-apps/plugin-shell';
import { homeDir, tempDir, join } from '@tauri-apps/api/path';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { getPlatformInfo } from '@/engine/platform';
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

export async function transformChatToEpic(sessionId: string, projectId: string): Promise<string> {
  const db = getDatabase();
  const [messages, session] = await Promise.all([
    db.loadMessages(sessionId),
    db.loadSession(sessionId),
  ]);
  const chatTitle = session?.title ?? 'Untitled Chat';

  const filtered = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  const last5StartIdx = Math.max(0, filtered.length - 5);
  // Indices (into filtered) of the last 5 messages
  const last5Indices = new Set(Array.from({ length: 5 }, (_, i) => last5StartIdx + i));

  const formatMessage = (m: typeof filtered[0], full: boolean) => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `${role}: ${full ? content : content.slice(0, 2000)}`;
  };

  const convo = filtered
    .slice(0, 60)
    .map((m, i) => formatMessage(m, last5Indices.has(i)))
    .join('\n\n');

  // Append last 5 in full only if they extend beyond the first 60
  const tail = filtered.length > 60
    ? '\n\n--- MOST RECENT MESSAGES (full) ---\n\n' +
      filtered.slice(Math.max(60, last5StartIdx)).map(m => formatMessage(m, true)).join('\n\n')
    : '';

  const prompt = `You are analyzing a software engineering chat conversation to define a detailed, actionable epic (a work item).

CHAT TITLE: ${chatTitle}

CONVERSATION:
${convo}${tail}

Based on the full conversation above, create a comprehensive and very detailed epic. Be thorough:
- The description should fully explain the problem, context, and proposed solution (as many sentences as needed).
- The acceptance criteria should be exhaustive — list every specific, testable condition that must be true for this epic to be considered done.
- Infer complexity and priority carefully from the technical depth of the discussion.

Return ONLY a valid JSON object with these exact fields (no markdown, no code fences, no explanation):
{
  "title": "<concise epic title, max 60 chars>",
  "description": "<thorough description covering context, problem, and solution>",
  "acceptanceCriteria": "<exhaustive bullet list, each criterion on its own line starting with - >",
  "priorityHint": "<one of: critical, high, medium, low, none>",
  "complexity": "<one of: trivial, small, medium, large, epic>"
}`;

  const tmp = await tempDir();
  const promptFile = await join(tmp, `angy-epic-${Date.now()}.txt`);
  await writeTextFile(promptFile, prompt);

  const home = (await homeDir()).replace(/\/+$/, '');
  const { os } = await getPlatformInfo();
  const pathParts = [
    `${home}/.local/bin`,
    `${home}/.nix-profile/bin`,
  ];
  if (os === 'macos') pathParts.push('/opt/homebrew/bin');
  pathParts.push(
    '/snap/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  );
  const env = {
    HOME: home,
    PATH: pathParts.join(':'),
  };

  const command = Command.create('exec-sh', [
    '-c',
    `claude -p --output-format json < "${promptFile}"`,
  ], { env });
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
