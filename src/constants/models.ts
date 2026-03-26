// ── Single source of truth for available LLM models ────────────────────────

export interface ModelEntry {
  id: string;
  name: string;
  desc: string;
  provider: 'claude-cli' | 'claude' | 'gemini' | 'codex-cli';
}

export interface ModelGroup {
  category: string;
  items: ModelEntry[];
}

export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6';
export const CODEX_DEFAULT_MODEL_ID = 'codex-default';

export const MODEL_GROUPS: ModelGroup[] = [
  {
    category: 'Claude Code',
    items: [
      { id: 'claude-sonnet-4-6', name: 'CC Sonnet 4.6', desc: 'Claude CLI', provider: 'claude-cli' },
      { id: 'claude-opus-4-5', name: 'CC Opus 4.5', desc: 'Claude CLI', provider: 'claude-cli' },
      { id: 'claude-opus-4-6', name: 'CC Opus 4.6', desc: 'Claude CLI', provider: 'claude-cli' },
      { id: 'claude-haiku-4-5-20251001', name: 'CC Haiku 4.5', desc: 'Claude CLI', provider: 'claude-cli' },
    ],
  },
  {
    category: 'Codex',
    items: [
      { id: CODEX_DEFAULT_MODEL_ID, name: 'Codex Default', desc: 'Use Codex CLI default model', provider: 'codex-cli' },
      { id: 'codex-gpt-5.4', name: 'GPT-5.4', desc: 'Codex · ChatGPT login', provider: 'codex-cli' },
      { id: 'codex-gpt-5.4-mini', name: 'GPT-5.4-Mini', desc: 'Codex · ChatGPT login', provider: 'codex-cli' },
      { id: 'codex-gpt-5.3-codex', name: 'GPT-5.3-Codex', desc: 'Codex · ChatGPT login', provider: 'codex-cli' },
      { id: 'codex-gpt-5.2-codex', name: 'GPT-5.2-Codex', desc: 'Codex · ChatGPT login', provider: 'codex-cli' },
      { id: 'codex-gpt-5.2', name: 'GPT-5.2', desc: 'Codex · ChatGPT login', provider: 'codex-cli' },
      { id: 'codex-gpt-5.1-codex-max', name: 'GPT-5.1-Codex-Max', desc: 'Codex · ChatGPT login', provider: 'codex-cli' },
      { id: 'codex-gpt-5.1-codex-mini', name: 'GPT-5.1-Codex-Mini', desc: 'Codex · ChatGPT login', provider: 'codex-cli' },
    ],
  },
  {
    category: 'Anthropic API',
    items: [
      { id: 'angy-claude-sonnet-4-6', name: 'Sonnet 4.6', desc: 'Anthropic API', provider: 'claude' },
      { id: 'angy-claude-opus-4-6', name: 'Opus 4.6', desc: 'Anthropic API', provider: 'claude' },
      { id: 'angy-claude-haiku-4-5-20251001', name: 'Haiku 4.5', desc: 'Anthropic API', provider: 'claude' },
    ],
  },
  {
    category: 'Gemini API',
    items: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Google · Fast', provider: 'gemini' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Google · Powerful', provider: 'gemini' },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', desc: 'Google · Preview', provider: 'gemini' },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', desc: 'Google · Preview', provider: 'gemini' },
    ],
  },
];

/** Flat list of every model across all groups. */
export const ALL_MODELS: ModelEntry[] = MODEL_GROUPS.flatMap(g => g.items);

/** Look up a model by id; returns undefined when not found. */
export function findModel(id: string): ModelEntry | undefined {
  return ALL_MODELS.find(m => m.id === id);
}
