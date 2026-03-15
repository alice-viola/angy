import { nanoid } from 'nanoid';
import { createEventBus } from '../events.js';
import { createSessionStore } from '../db/sessionStore.js';
import { createMessageStore } from '../db/messageStore.js';
import { createUsageStore } from '../db/usageStore.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { estimateCost } from './cost.js';
import type {
  AgentLoopOptions,
  AgentEvent,
  Session,
  Message,
  ContentPart,
  ToolDefinition,
  ToolContext,
  ProviderStreamEvent,
} from '../types.js';
import type { SessionStore } from '../db/sessionStore.js';
import type { MessageStore } from '../db/messageStore.js';
import type { UsageStore } from '../db/usageStore.js';

const DEFAULT_MODEL = 'claude-opus-4-6';

export class AgentLoop {
  private options: AgentLoopOptions;
  private bus = createEventBus();
  private sessionStore: SessionStore;
  private messageStore: MessageStore;
  private usageStore: UsageStore;
  private filesRead = new Set<string>();
  private aborted = false;
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
  }

  async run(goal: string): Promise<Session> {
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
      id: nanoid(),
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

    const userMessage: Message = {
      role: 'user',
      content: [{ type: 'text', text: goal }],
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

  async continueSession(sessionId: string, message: string): Promise<Session> {
    this.aborted = false;

    const session = this.sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    this.sessionStore.updateSession(session.id, { status: 'running' });

    const userMessage: Message = {
      role: 'user',
      content: [{ type: 'text', text: message }],
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

      try {
        const stream = this.options.provider.streamMessage({
          model: this.model,
          system,
          messages,
          tools: toolDefs,
          maxTokens: this.options.maxTokens,
        });

        for await (const event of stream) {
          this.processStreamEvent(
            event,
            assistantParts,
            pendingToolCalls,
          );

          if (event.type === 'message_end') {
            stopReason = event.stop_reason as typeof stopReason;
            inputTokens = event.usage.input;
            outputTokens = event.usage.output;
            if (event.stop_reason === 'error' && event.error) {
              this.sessionStore.updateSession(session.id, { status: 'error' });
              this.emit({ type: 'error', message: event.error });
              return this.sessionStore.getSession(session.id)!;
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.sessionStore.updateSession(session.id, { status: 'error' });
        this.emit({ type: 'error', message: msg });
        return this.sessionStore.getSession(session.id)!;
      }

      // Persist assistant message
      const assistantMessage: Message = { role: 'assistant', content: assistantParts };
      messages.push(assistantMessage);
      this.messageStore.addMessage(session.id, assistantMessage);

      // Record usage
      const cost = estimateCost(this.model, inputTokens, outputTokens);
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
        cost_usd: cost,
      });

      // Handle error from provider
      if (stopReason === 'error') {
        this.sessionStore.updateSession(session.id, { status: 'error' });
        this.emit({ type: 'error', message: 'Provider returned an error' });
        return this.sessionStore.getSession(session.id)!;
      }

      // If no tool calls, we're done
      if (pendingToolCalls.size === 0) {
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
          result = await tool.execute(input, ctx);
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
