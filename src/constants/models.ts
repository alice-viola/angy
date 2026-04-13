// ── Single source of truth for available LLM models ────────────────────────

export interface ModelEntry {
  id: string;
  name: string;
  desc: string;
  provider: 'claude-cli' | 'claude' | 'gemini' | 'ollama';
}

export interface ModelGroup {
  category: string;
  items: ModelEntry[];
}

export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6';

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
  {
    category: 'Local (Ollama)',
    items: [
      { id: 'ollama-gemma4', name: 'Gemma 4 E4B', desc: 'Local · 9.6 GB', provider: 'ollama' },
      { id: 'ollama-gemma4:e2b', name: 'Gemma 4 E2B', desc: 'Local · 7.2 GB', provider: 'ollama' },
      { id: 'ollama-gemma4:26b', name: 'Gemma 4 26B MoE', desc: 'Local · 18 GB', provider: 'ollama' },
      { id: 'ollama-gemma4:31b', name: 'Gemma 4 31B Dense', desc: 'Local · 20 GB', provider: 'ollama' },
    ],
  },
];

/** Flat list of every model across all groups. */
export const ALL_MODELS: ModelEntry[] = MODEL_GROUPS.flatMap(g => g.items);

/** Look up a model by id; returns undefined when not found. */
export function findModel(id: string): ModelEntry | undefined {
  return ALL_MODELS.find(m => m.id === id);
}
