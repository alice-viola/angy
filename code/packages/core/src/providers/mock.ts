import type {
  ProviderAdapter,
  StreamParams,
  ProviderStreamEvent,
} from '../types.js';

/**
 * A mock provider that replays a canned sequence of events for testing.
 *
 * Turn 1: emits two text deltas + a tool call + message_end
 * Turn 2+: emits one text delta + message_end (no tool calls → loop exits)
 */
export class MockAdapter implements ProviderAdapter {
  private callCount = 0;

  async *streamMessage(_params: StreamParams): AsyncIterable<ProviderStreamEvent> {
    this.callCount++;

    if (this.callCount === 1) {
      // First turn: text + tool call
      yield { type: 'text_delta', text: 'Hello, ' };
      yield { type: 'text_delta', text: 'world!' };
      yield { type: 'tool_call_start', id: 'mock-tool-1', name: 'mock_echo' };
      yield { type: 'tool_call_delta', id: 'mock-tool-1', input: '{"msg":"hi"}' };
      yield { type: 'tool_call_end', id: 'mock-tool-1' };
      yield {
        type: 'message_end',
        stop_reason: 'end_turn',
        usage: { input: 10, output: 5 },
      };
    } else {
      // Subsequent turns: just text, no tool calls → loop terminates
      yield { type: 'text_delta', text: 'Done!' };
      yield {
        type: 'message_end',
        stop_reason: 'end_turn',
        usage: { input: 5, output: 3 },
      };
    }
  }
}
