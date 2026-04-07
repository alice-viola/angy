import { nanoid } from 'nanoid';
import { createEventBus } from '../events.js';
import { createSessionStore } from '../db/sessionStore.js';
import { createMessageStore } from '../db/messageStore.js';
import { createUsageStore } from '../db/usageStore.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { estimateCost } from './cost.js';
import { compactMessages } from './contextCompactor.js';
import type {
  AgentLoopOptions,
  AgentEvent,
  Session,
  Message,
  ContentPart,
  ToolDefinition,
  ToolContext,
  ProviderStreamEvent,
  ImageInput,
} from '../types.js';
import type { SessionStore } from '../db/sessionStore.js';
import type { MessageStore } from '../db/messageStore.js';
import type { UsageStore } from '../db/usageStore.js';

const DEFAULT_MODEL = 'claude-opus-4-6';

const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-20250514': 200_000,
  'claude-sonnet-4-6':        200_000,
  'claude-opus-4-20250514':   200_000,
  'claude-opus-4-6':          200_000,
  'claude-haiku-4-5-20251001':200_000,
  'gemini-2.5-flash':       1_000_000,
  'gemini-2.5-pro':         2_000_000,
  'gemini-2.0-flash':       1_000_000,
  'gemini-2.0-pro':         1_000_000,
};

export class AgentLoop {
  private options: AgentLoopOptions;
  private bus = createEventBus();
  private sessionStore: SessionStore;
  private messageStore: MessageStore;
  private usageStore: UsageStore;
  private filesRead = new Set<string>();
  private aborted = false;
  private abortController: AbortController | null = null;
  private totalCostUsd = 0;

  constructor(options: AgentLoopOptions) {
    this.options = options;
    this.sessionStore = createSessionStore(options.db.db);
    this.messageStore = createMessageStore(options.db.db);
    this.usageStore = createUsageStore(options.db.db);
  }

  get providerName(): import('../types.js').ProviderName {
    return this.options.providerName ?? 'anthropic';
  }

  get model(): string {
    return this.options.model ?? DEFAULT_MODEL;
  }

  on(event: 'event', listener: (event: AgentEvent) => void): void {
    this.bus.on(event, listener);
  }

  private emit(event: AgentEvent): void {
    this.bus.emit('event', event);
  }

  abort(): void {
    this.aborted = true;
    this.abortController?.abort();
  }

  async run(goal: string, images?: ImageInput[]): Promise<Session> {
    this.aborted = false;
    this.totalCostUsd = 0;

    // Build system prompt early so we can store it
    const disabledSet = new Set(this.options.disabledTools ?? []);
    const tools = this.options.tools
      .all()
      .filter((t) => !disabledSet.has(t.definition.name));
    const toolDefs: ToolDefinition[] = tools.map((t) => t.definition);

    const system = buildSystemPrompt({
      workingDir: this.options.workingDir,
      tools: toolDefs,
      extra: this.options.systemPromptExtra,
    });

    const session = this.sessionStore.createSession({
      id: this.options.sessionId ?? nanoid(),
      goal,
      provider: this.providerName,
      model: this.model,
      status: 'running',
      workingDir: this.options.workingDir,
      systemPrompt: system,
    });

    this.emit({
      type: 'session_start',
      sessionId: session.id,
      provider: this.providerName,
      model: this.model,
      workingDir: this.options.workingDir,
    });

    // Build user message content with text and optional images
    const content: ContentPart[] = [{ type: 'text', text: goal }];
    if (images && images.length > 0) {
      for (const img of images) {
        content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
      }
    }

    const userMessage: Message = {
      role: 'user',
      content,
    };
    this.messageStore.addMessage(session.id, userMessage);

    const messages: Message[] = [userMessage];
    return this._loop(session, messages, system, tools, toolDefs);
  }

  async resume(sessionId: string): Promise<Session> {
    this.aborted = false;
    this.totalCostUsd = 0;

    const session = this.sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    this.sessionStore.updateSession(session.id, { status: 'running' });

    this.emit({
      type: 'session_start',
      sessionId: session.id,
      provider: this.providerName,
      model: this.model,
      workingDir: this.options.workingDir,
    });

    const messages = this.messageStore.getMessages(session.id);

    // Build tool definitions
    const disabledSet = new Set(this.options.disabledTools ?? []);
    const tools = this.options.tools
      .all()
      .filter((t) => !disabledSet.has(t.definition.name));
    const toolDefs: ToolDefinition[] = tools.map((t) => t.definition);

    const system = buildSystemPrompt({
      workingDir: this.options.workingDir,
      tools: toolDefs,
      extra: this.options.systemPromptExtra,
    });

    return this._loop(session, messages, system, tools, toolDefs);
  }

  async continueSession(sessionId: string, message: string, images?: ImageInput[]): Promise<Session> {
    this.aborted = false;

    const session = this.sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    this.sessionStore.updateSession(session.id, { status: 'running' });

    // Build user message content with text and optional images
    const content: ContentPart[] = [{ type: 'text', text: message }];
    if (images && images.length > 0) {
      for (const img of images) {
        content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
      }
    }

    const userMessage: Message = {
      role: 'user',
      content,
    };
    this.messageStore.addMessage(session.id, userMessage);

    const messages = this.messageStore.getMessages(session.id);

    const disabledSet = new Set(this.options.disabledTools ?? []);
    const tools = this.options.tools
      .all()
      .filter((t) => !disabledSet.has(t.definition.name));
    const toolDefs: ToolDefinition[] = tools.map((t) => t.definition);

    const system = buildSystemPrompt({
      workingDir: this.options.workingDir,
      tools: toolDefs,
      extra: this.options.systemPromptExtra,
    });

    return this._loop(session, messages, system, tools, toolDefs);
  }

  private async _loop(
    session: Session,
    messages: Message[],
    system: string,
    tools: { definition: ToolDefinition; execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<import('../types.js').ToolResult> }[],
    toolDefs: ToolDefinition[],
  ): Promise<Session> {
    let turns = 0;

    while (turns < this.options.maxTurns) {
      if (this.aborted) {
        this.sessionStore.updateSession(session.id, { status: 'paused' });
        this.emit({
          type: 'done',
          stop_reason: 'aborted',
        });
        return this.sessionStore.getSession(session.id)!;
      }

      turns++;
      this.sessionStore.incrementTurnCount(session.id);

      // Stream from provider
      const assistantParts: ContentPart[] = [];
      const pendingToolCalls = new Map<
        string,
        { name: string; inputJson: string; thought_signature?: string }
      >();
      let stopReason = 'end_turn' as 'end_turn' | 'max_tokens' | 'error';
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationInputTokens: number | undefined;
      let cacheReadInputTokens: number | undefined;

      try {
        this.abortController = new AbortController();

        // Compact stale context before sending to provider
        const contextWindow = CONTEXT_WINDOWS[this.model] ?? 200_000;
        const { messages: compactedMessages } = compactMessages(messages, {
          contextWindow,
          workingTurns: 6,
          systemTokens: Math.ceil(system.length / 3.5),
          toolTokens: toolDefs.length * 200,
        });

        const stream = this.options.provider.streamMessage({
          model: this.model,
          system,
          messages: compactedMessages,
          tools: toolDefs,
          maxTokens: this.options.maxTokens,
          signal: this.abortController.signal,
        });

        for await (const event of stream) {
          if (this.aborted) {
            break;
          }
          this.processStreamEvent(
            event,
            assistantParts,
            pendingToolCalls,
          );

          if (event.type === 'message_end') {
            stopReason = event.stop_reason as typeof stopReason;
            inputTokens = event.usage.input;
            outputTokens = event.usage.output;
            cacheCreationInputTokens = event.usage.cache_creation_input;
            cacheReadInputTokens = event.usage.cache_read_input;
            if (event.stop_reason === 'error' && event.error) {
              this.sessionStore.updateSession(session.id, { status: 'error' });
              this.emit({ type: 'error', message: event.error });
              return this.sessionStore.getSession(session.id)!;
            }
          }
        }
      } catch (err: unknown) {
        // Check if error is due to abort (AbortError)
        if (this.aborted || (err instanceof Error && err.name === 'AbortError')) {
          this.sessionStore.updateSession(session.id, { status: 'paused' });
          this.emit({ type: 'done', stop_reason: 'aborted' });
          return this.sessionStore.getSession(session.id)!;
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.sessionStore.updateSession(session.id, { status: 'error' });
        this.emit({ type: 'error', message: msg });
        return this.sessionStore.getSession(session.id)!;
      }

      // Check abort after streaming - don't execute tools if aborted
      if (this.aborted) {
        this.sessionStore.updateSession(session.id, { status: 'paused' });
        this.emit({ type: 'done', stop_reason: 'aborted' });
        return this.sessionStore.getSession(session.id)!;
      }

      // Persist assistant message
      const assistantMessage: Message = { role: 'assistant', content: assistantParts };
      messages.push(assistantMessage);
      this.messageStore.addMessage(session.id, assistantMessage);

      // Record usage
      const cost = estimateCost(this.model, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens);
      if (cost !== undefined) this.totalCostUsd += cost;

      this.usageStore.recordUsage({
        sessionId: session.id,
        provider: session.provider,
        model: this.model,
        inputTokens,
        outputTokens,
        costUsd: cost,
      });

      this.emit({
        type: 'usage',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheCreationInputTokens,
        cache_read_input_tokens: cacheReadInputTokens,
        cost_usd: cost,
      });

      // Handle error from provider
      if (stopReason === 'error') {
        this.sessionStore.updateSession(session.id, { status: 'error' });
        this.emit({ type: 'error', message: 'Provider returned an error' });
        return this.sessionStore.getSession(session.id)!;
      }

      // If no tool calls, we might be done, or we might need to nudge the model
      if (pendingToolCalls.size === 0) {
        const hasText = assistantParts.some(p => p.type === 'text' && ('text' in p) && typeof p.text === 'string' && p.text.trim().length > 0);

        if (stopReason === 'max_tokens' || !hasText) {
          const nudgeText = stopReason === 'max_tokens'
            ? 'System: Your response was truncated (max_tokens). Please continue where you left off.'
            : 'System: You returned an empty response. If you are finished, summarize your actions to the user. If you are not finished, please call the next tool.';

          const nudgeMessage: Message = { role: 'user', content: [{ type: 'text', text: nudgeText }] };
          messages.push(nudgeMessage);
          this.messageStore.addMessage(session.id, nudgeMessage);
          continue;
        }

        this.sessionStore.updateSession(session.id, { status: 'done' });
        this.emit({
          type: 'done',
          stop_reason: stopReason,
        });
        return this.sessionStore.getSession(session.id)!;
      }

      // Execute tool calls
      const toolResultParts: ContentPart[] = [];

      const ctx: ToolContext = {
        workingDir: this.options.workingDir,
        sessionId: session.id,
        filesRead: this.filesRead,
        emit: (e) => this.emit(e),
      };

      for (const [id, call] of pendingToolCalls) {
        // Check abort before each tool execution
        if (this.aborted) {
          this.sessionStore.updateSession(session.id, { status: 'paused' });
          this.emit({ type: 'done', stop_reason: 'aborted' });
          return this.sessionStore.getSession(session.id)!;
        }

        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.inputJson || '{}') as Record<string, unknown>;
        } catch {
          // malformed JSON
        }

        this.emit({
          type: 'tool_start',
          id,
          name: call.name,
          input,
        });

        const tool = tools.find((t) => t.definition.name === call.name);
        const start = Date.now();
        let result = { content: `Error: Unknown tool: ${call.name}`, is_error: true };

        if (tool) {
          try {
            result = await tool.execute(input, ctx);
          } catch (toolErr: unknown) {
            const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
            result = { content: `Error: Tool execution failed: ${errMsg}`, is_error: true };
          }
        }

        const durationMs = Date.now() - start;

        this.emit({
          type: 'tool_output',
          id,
          name: call.name,
          output: result.content,
          is_error: result.is_error,
          duration_ms: durationMs,
        });

        this.usageStore.recordToolExecution({
          sessionId: session.id,
          toolName: call.name,
          input,
          output: result.content,
          isError: result.is_error,
          durationMs,
        });

        toolResultParts.push({
          type: 'tool_result',
          tool_use_id: id,
          content: result.content,
          is_error: result.is_error,
        });
      }

      // Add tool results as user message
      const toolMessage: Message = { role: 'user', content: toolResultParts };
      messages.push(toolMessage);
      this.messageStore.addMessage(session.id, toolMessage);
    }

    // Max turns reached
    this.sessionStore.updateSession(session.id, { status: 'paused' });
    this.emit({
      type: 'done',
      stop_reason: 'max_turns',
    });
    return this.sessionStore.getSession(session.id)!;
  }

  private processStreamEvent(
    event: ProviderStreamEvent,
    parts: ContentPart[],
    pendingToolCalls: Map<string, { name: string; inputJson: string; thought_signature?: string }>,
  ): void {
    switch (event.type) {
      case 'text_delta':
        // Accumulate text into the last text part, or create new one
        {
          const last = parts[parts.length - 1];
          if (last && last.type === 'text') {
            last.text += event.text;
          } else {
            parts.push({ type: 'text', text: event.text });
          }
          this.emit({ type: 'text', text: event.text });
        }
        break;

      case 'tool_call_start':
        pendingToolCalls.set(event.id, { name: event.name, inputJson: '', thought_signature: event.thought_signature });
        break;

      case 'tool_call_delta': {
        const call = pendingToolCalls.get(event.id);
        if (call) {
          call.inputJson += event.input;
        }
        break;
      }

      case 'tool_call_end': {
        const call = pendingToolCalls.get(event.id);
        if (call) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(call.inputJson || '{}') as Record<string, unknown>;
          } catch {
            // malformed JSON
          }
          parts.push({
            type: 'tool_use',
            id: event.id,
            name: call.name,
            input,
            ...(call.thought_signature ? { thought_signature: call.thought_signature } : {}),
          });
        }
        break;
      }

      case 'message_end':
        // Handled in the main loop
        break;
    }
  }
}
