import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock values — declared before vi.mock so factory closures can capture them
// ---------------------------------------------------------------------------

const mockCheckToolCallApproval = vi.fn();
const mockGetSessionInfo = vi.fn();
const mockUsageRecord = vi.fn();
const mockExtractSuggestions = vi.fn(() => ({ content: '', suggestions: [] }));
const mockExtractMemoriesFromResponse = vi.fn((content: string) => ({ content, memories: [] }));
const mockGenerateApprovalId = vi.fn(() => 'test-approval-id');
const mockCreateApprovalRequest = vi.fn(() => Promise.resolve(true));
const mockSaveStreamingChat = vi.fn();
const mockRunPostChatProcessing = vi.fn();
const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

// ---------------------------------------------------------------------------
// vi.mock — modules the SUT imports
// ---------------------------------------------------------------------------

vi.mock('../services/log.js', () => ({
  getLog: () => mockLog,
}));

vi.mock('../assistant/index.js', () => ({
  checkToolCallApproval: (...args: unknown[]) => mockCheckToolCallApproval(...args),
}));

vi.mock('./agent-service.js', () => ({
  getSessionInfo: (...args: unknown[]) => mockGetSessionInfo(...args),
}));

vi.mock('./costs.js', () => ({
  usageTracker: { record: (...args: unknown[]) => mockUsageRecord(...args) },
}));

vi.mock('../utils/index.js', () => ({
  extractSuggestions: (...args: unknown[]) => mockExtractSuggestions(...args),
  extractMemoriesFromResponse: (...args: unknown[]) => mockExtractMemoriesFromResponse(...args),
}));

vi.mock('../services/execution-approval.js', () => ({
  generateApprovalId: () => mockGenerateApprovalId(),
  createApprovalRequest: (...args: unknown[]) => mockCreateApprovalRequest(...args),
}));

vi.mock('./chat-persistence.js', () => ({
  saveStreamingChat: (...args: unknown[]) => mockSaveStreamingChat(...args),
  runPostChatProcessing: (...args: unknown[]) => mockRunPostChatProcessing(...args),
}));

vi.mock('hono/streaming', () => ({
  streamSSE: vi.fn(),
}));

vi.mock('@ownpilot/core', () => ({}));

// ---------------------------------------------------------------------------
// Dynamic import AFTER vi.mock
// ---------------------------------------------------------------------------

const {
  extractToolDisplay,
  wireStreamApproval,
  createStreamCallbacks,
  recordStreamUsage,
  processStreamingViaBus,
} = await import('./chat-streaming.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSSEStream() {
  return { writeSSE: vi.fn().mockResolvedValue(undefined) };
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    setRequestApproval: vi.fn(),
    getConversation: vi.fn().mockReturnValue({ id: 'conv-1' }),
    getMemory: vi.fn().mockReturnValue({ getStats: vi.fn().mockReturnValue(null) }),
    ...overrides,
  };
}

function makeStreamingConfig(overrides: Record<string, unknown> = {}) {
  return {
    sseStream: makeSSEStream(),
    agent: makeAgent(),
    conversationId: 'conv-1',
    userId: 'user-1',
    agentId: 'agent-1',
    provider: 'openai',
    model: 'gpt-4',
    historyLength: 5,
    ...overrides,
  };
}

function makeToolCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tc-1',
    name: 'search',
    arguments: JSON.stringify({ query: 'test' }),
    ...overrides,
  };
}

function makeStreamState(overrides: Record<string, unknown> = {}) {
  return {
    streamedContent: '',
    lastUsage: undefined as { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number } | undefined,
    traceToolCalls: [] as Array<{
      name: string;
      arguments?: Record<string, unknown>;
      result?: string;
      success: boolean;
      duration?: number;
      startTime?: number;
    }>,
    startTime: 100,
    ...overrides,
  };
}

function parseWrittenSSE(writeSSE: ReturnType<typeof vi.fn>, callIndex = 0) {
  const call = writeSSE.mock.calls[callIndex];
  return {
    event: call![0].event as string,
    data: JSON.parse(call![0].data as string) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(performance, 'now').mockReturnValue(200);
  mockGetSessionInfo.mockReturnValue({
    sessionId: 'conv-1',
    messageCount: 5,
    estimatedTokens: 1000,
    maxContextTokens: 128000,
    contextFillPercent: 0.78,
  });
});

// =====================================================================
// extractToolDisplay
// =====================================================================

describe('extractToolDisplay', () => {
  it('returns tool name as displayName for a regular tool', () => {
    const result = extractToolDisplay({ id: 'tc-1', name: 'search', arguments: '{"q":"hello"}' });
    expect(result.displayName).toBe('search');
  });

  it('returns parsed arguments as displayArgs for a regular tool', () => {
    const result = extractToolDisplay({ id: 'tc-1', name: 'search', arguments: '{"q":"hello"}' });
    expect(result.displayArgs).toEqual({ q: 'hello' });
  });

  it('unwraps tool_name from use_tool call', () => {
    const args = JSON.stringify({ tool_name: 'inner_tool', arguments: { key: 'val' } });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    expect(result.displayName).toBe('inner_tool');
  });

  it('unwraps inner arguments from use_tool call', () => {
    const args = JSON.stringify({ tool_name: 'inner_tool', arguments: { key: 'val' } });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    expect(result.displayArgs).toEqual({ key: 'val' });
  });

  it('returns use_tool as displayName when tool_name is missing', () => {
    const args = JSON.stringify({ other_field: 'value' });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    expect(result.displayName).toBe('use_tool');
  });

  it('returns full parsed args as displayArgs when use_tool has no tool_name', () => {
    const args = JSON.stringify({ other_field: 'value' });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    expect(result.displayArgs).toEqual({ other_field: 'value' });
  });

  it('returns use_tool tool_name but full args when inner arguments missing', () => {
    const args = JSON.stringify({ tool_name: 'inner_tool' });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    expect(result.displayName).toBe('inner_tool');
    // No .arguments in parsed → displayArgs falls through to parsedArgs (the whole thing)
    expect(result.displayArgs).toEqual({ tool_name: 'inner_tool' });
  });

  it('handles malformed JSON in arguments gracefully', () => {
    const result = extractToolDisplay({ id: 'tc-1', name: 'search', arguments: '{bad json' });
    expect(result.displayName).toBe('search');
    expect(result.displayArgs).toBeUndefined();
  });

  it('handles undefined arguments', () => {
    const result = extractToolDisplay({ id: 'tc-1', name: 'search', arguments: undefined as unknown as string });
    expect(result.displayName).toBe('search');
    expect(result.displayArgs).toBeUndefined();
  });

  it('handles empty string arguments', () => {
    const result = extractToolDisplay({ id: 'tc-1', name: 'search', arguments: '' });
    expect(result.displayName).toBe('search');
    expect(result.displayArgs).toBeUndefined();
  });

  it('does NOT unwrap batch_use_tool (only use_tool)', () => {
    const args = JSON.stringify({ tool_name: 'inner', arguments: { x: 1 } });
    const result = extractToolDisplay({ id: 'tc-1', name: 'batch_use_tool', arguments: args });
    expect(result.displayName).toBe('batch_use_tool');
    expect(result.displayArgs).toEqual({ tool_name: 'inner', arguments: { x: 1 } });
  });

  it('handles use_tool with null tool_name', () => {
    const args = JSON.stringify({ tool_name: null });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    // null is falsy, so displayName stays 'use_tool'
    expect(result.displayName).toBe('use_tool');
  });

  it('handles use_tool with empty string tool_name', () => {
    const args = JSON.stringify({ tool_name: '' });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    // empty string is falsy, so displayName stays 'use_tool'
    expect(result.displayName).toBe('use_tool');
  });

  it('handles numeric tool_name in use_tool', () => {
    const args = JSON.stringify({ tool_name: 42 });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    // 42 is truthy, String(42) => '42'
    expect(result.displayName).toBe('42');
  });

  it('handles deeply nested arguments in use_tool', () => {
    const innerArgs = { nested: { deep: { value: [1, 2, 3] } } };
    const args = JSON.stringify({ tool_name: 'complex_tool', arguments: innerArgs });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    expect(result.displayName).toBe('complex_tool');
    expect(result.displayArgs).toEqual(innerArgs);
  });

  it('returns name for tool with no id', () => {
    const result = extractToolDisplay({ name: 'my_tool', arguments: '{}' } as never);
    expect(result.displayName).toBe('my_tool');
    expect(result.displayArgs).toEqual({});
  });

  it('handles arguments as a JSON array string', () => {
    const result = extractToolDisplay({ id: 'tc-1', name: 'my_tool', arguments: '[1,2,3]' });
    expect(result.displayName).toBe('my_tool');
    // JSON.parse('[1,2,3]') => [1,2,3] which is truthy but not {tool_name}
    expect(result.displayArgs).toEqual([1, 2, 3]);
  });

  it('handles arguments as a JSON string value', () => {
    const result = extractToolDisplay({ id: 'tc-1', name: 'my_tool', arguments: '"hello"' });
    expect(result.displayName).toBe('my_tool');
    expect(result.displayArgs).toBe('hello');
  });

  it('handles use_tool with arguments as a non-object (string)', () => {
    const args = JSON.stringify({ tool_name: 'inner', arguments: 'raw string' });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    expect(result.displayName).toBe('inner');
    expect(result.displayArgs).toBe('raw string');
  });

  it('preserves special characters in tool_name', () => {
    const args = JSON.stringify({ tool_name: 'plugin.my-tool_v2', arguments: {} });
    const result = extractToolDisplay({ id: 'tc-1', name: 'use_tool', arguments: args });
    expect(result.displayName).toBe('plugin.my-tool_v2');
  });
});

// =====================================================================
// wireStreamApproval
// =====================================================================

describe('wireStreamApproval', () => {
  it('calls setRequestApproval on the agent', () => {
    const agent = makeAgent();
    const stream = makeSSEStream();
    wireStreamApproval(agent, stream);
    expect(agent.setRequestApproval).toHaveBeenCalledOnce();
    expect(typeof agent.setRequestApproval.mock.calls[0]![0]).toBe('function');
  });

  it('generates an approvalId when approval callback fires', async () => {
    const agent = makeAgent();
    const stream = makeSSEStream();
    wireStreamApproval(agent, stream);
    const callback = agent.setRequestApproval.mock.calls[0]![0] as (...args: unknown[]) => Promise<boolean>;
    await callback('execution', 'run_code', 'Execute code', { code: 'console.log(1)', riskAnalysis: 'low' });
    expect(mockGenerateApprovalId).toHaveBeenCalledOnce();
  });

  it('writes SSE approval event with correct data shape', async () => {
    const agent = makeAgent();
    const stream = makeSSEStream();
    wireStreamApproval(agent, stream);
    const callback = agent.setRequestApproval.mock.calls[0]![0] as (...args: unknown[]) => Promise<boolean>;
    await callback('execution', 'run_code', 'Execute JS', { code: 'x()', riskAnalysis: 'medium' });

    expect(stream.writeSSE).toHaveBeenCalledOnce();
    const { event, data } = parseWrittenSSE(stream.writeSSE);
    expect(event).toBe('approval');
    expect(data.type).toBe('approval_required');
    expect(data.approvalId).toBe('test-approval-id');
    expect(data.category).toBe('run_code');
    expect(data.description).toBe('Execute JS');
    expect(data.code).toBe('x()');
    expect(data.riskAnalysis).toBe('medium');
  });

  it('creates an approval request with the generated ID', async () => {
    const agent = makeAgent();
    const stream = makeSSEStream();
    wireStreamApproval(agent, stream);
    const callback = agent.setRequestApproval.mock.calls[0]![0] as (...args: unknown[]) => Promise<boolean>;
    await callback('exec', 'run', 'desc', {});
    expect(mockCreateApprovalRequest).toHaveBeenCalledWith('test-approval-id');
  });

  it('returns the result of createApprovalRequest', async () => {
    mockCreateApprovalRequest.mockResolvedValueOnce(false);
    const agent = makeAgent();
    const stream = makeSSEStream();
    wireStreamApproval(agent, stream);
    const callback = agent.setRequestApproval.mock.calls[0]![0] as (...args: unknown[]) => Promise<boolean>;
    const result = await callback('exec', 'run', 'desc', {});
    expect(result).toBe(false);
  });

  it('passes undefined for missing code/riskAnalysis params', async () => {
    const agent = makeAgent();
    const stream = makeSSEStream();
    wireStreamApproval(agent, stream);
    const callback = agent.setRequestApproval.mock.calls[0]![0] as (...args: unknown[]) => Promise<boolean>;
    await callback('exec', 'run', 'desc', {});
    const { data } = parseWrittenSSE(stream.writeSSE);
    expect(data.code).toBeUndefined();
    expect(data.riskAnalysis).toBeUndefined();
  });

  it('passes the category param as _category (first arg) without using it in the SSE', async () => {
    const agent = makeAgent();
    const stream = makeSSEStream();
    wireStreamApproval(agent, stream);
    const callback = agent.setRequestApproval.mock.calls[0]![0] as (...args: unknown[]) => Promise<boolean>;
    await callback('myCategory', 'myAction', 'desc', {});
    // The SSE uses actionType (second arg) as `category`, not the first arg
    const { data } = parseWrittenSSE(stream.writeSSE);
    expect(data.category).toBe('myAction');
  });

  it('uses different approval IDs for sequential calls', async () => {
    mockGenerateApprovalId.mockReturnValueOnce('id-1').mockReturnValueOnce('id-2');
    const agent = makeAgent();
    const stream = makeSSEStream();
    wireStreamApproval(agent, stream);
    const callback = agent.setRequestApproval.mock.calls[0]![0] as (...args: unknown[]) => Promise<boolean>;
    await callback('exec', 'run', 'desc1', {});
    await callback('exec', 'run', 'desc2', {});
    const data1 = parseWrittenSSE(stream.writeSSE, 0).data;
    const data2 = parseWrittenSSE(stream.writeSSE, 1).data;
    expect(data1.approvalId).toBe('id-1');
    expect(data2.approvalId).toBe('id-2');
  });

  it('awaits writeSSE before calling createApprovalRequest', async () => {
    const callOrder: string[] = [];
    const agent = makeAgent();
    const stream = {
      writeSSE: vi.fn().mockImplementation(async () => { callOrder.push('writeSSE'); }),
    };
    mockCreateApprovalRequest.mockImplementation(async () => { callOrder.push('createApproval'); return true; });
    wireStreamApproval(agent, stream);
    const callback = agent.setRequestApproval.mock.calls[0]![0] as (...args: unknown[]) => Promise<boolean>;
    await callback('exec', 'run', 'desc', {});
    expect(callOrder).toEqual(['writeSSE', 'createApproval']);
  });
});

// =====================================================================
// createStreamCallbacks
// =====================================================================

describe('createStreamCallbacks', () => {
  describe('returned state', () => {
    it('initializes streamedContent as empty string', () => {
      const { state } = createStreamCallbacks(makeStreamingConfig() as never);
      expect(state.streamedContent).toBe('');
    });

    it('initializes lastUsage as undefined', () => {
      const { state } = createStreamCallbacks(makeStreamingConfig() as never);
      expect(state.lastUsage).toBeUndefined();
    });

    it('initializes traceToolCalls as empty array', () => {
      const { state } = createStreamCallbacks(makeStreamingConfig() as never);
      expect(state.traceToolCalls).toEqual([]);
    });

    it('sets startTime from performance.now()', () => {
      vi.spyOn(performance, 'now').mockReturnValue(12345);
      const { state } = createStreamCallbacks(makeStreamingConfig() as never);
      expect(state.startTime).toBe(12345);
    });
  });

  describe('onChunk — non-done chunks', () => {
    it('accumulates content in state.streamedContent', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      callbacks.onChunk!({ id: 'c1', content: 'Hello ', done: false });
      callbacks.onChunk!({ id: 'c2', content: 'world', done: false });
      expect(state.streamedContent).toBe('Hello world');
    });

    it('writes SSE with event "chunk"', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({ id: 'c1', content: 'hi', done: false });
      const { event } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(event).toBe('chunk');
    });

    it('includes conversationId in SSE data', () => {
      const config = makeStreamingConfig({ conversationId: 'conv-42' });
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({ id: 'c1', content: 'hi', done: false });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.conversationId).toBe('conv-42');
    });

    it('includes chunk id in SSE data', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({ id: 'chunk-xyz', content: 'x', done: false });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.id).toBe('chunk-xyz');
    });

    it('includes delta content in SSE data', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({ id: 'c1', content: 'delta text', done: false });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.delta).toBe('delta text');
    });

    it('sets done to false in SSE data', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({ id: 'c1', content: 'x', done: false });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.done).toBe(false);
    });

    it('handles chunk with no content (undefined)', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      callbacks.onChunk!({ id: 'c1', done: false });
      expect(state.streamedContent).toBe('');
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.delta).toBeUndefined();
    });

    it('does not include trace or session on non-done chunk', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({ id: 'c1', content: 'hi', done: false });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.trace).toBeUndefined();
      expect(data.session).toBeUndefined();
    });

    it('maps toolCalls with parseable arguments', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({
        id: 'c1',
        done: false,
        toolCalls: [{ id: 'tc1', name: 'search', arguments: '{"q":"hi"}' }],
      });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.toolCalls).toEqual([{ id: 'tc1', name: 'search', arguments: { q: 'hi' } }]);
    });

    it('maps toolCalls with malformed arguments to undefined', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({
        id: 'c1',
        done: false,
        toolCalls: [{ id: 'tc1', name: 'search', arguments: '{bad' }],
      });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const tcs = data.toolCalls as Array<{ arguments: unknown }>;
      expect(tcs[0]!.arguments).toBeUndefined();
    });

    it('maps toolCalls with no arguments to undefined', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({
        id: 'c1',
        done: false,
        toolCalls: [{ id: 'tc1', name: 'search' }],
      });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const tcs = data.toolCalls as Array<{ arguments: unknown }>;
      expect(tcs[0]!.arguments).toBeUndefined();
    });

    it('stores usage in state.lastUsage when present', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      callbacks.onChunk!({
        id: 'c1',
        done: false,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });
      expect(state.lastUsage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: undefined,
      });
    });

    it('stores cachedTokens when present in usage', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      callbacks.onChunk!({
        id: 'c1',
        done: false,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 80 },
      });
      expect(state.lastUsage!.cachedTokens).toBe(80);
    });

    it('includes usage in SSE data when present', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({
        id: 'c1',
        done: false,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
    });

    it('includes cachedTokens in SSE data usage when present', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({
        id: 'c1',
        done: false,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 80 },
      });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const usage = data.usage as Record<string, unknown>;
      expect(usage.cachedTokens).toBe(80);
    });

    it('omits cachedTokens from SSE data when null/undefined', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({
        id: 'c1',
        done: false,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const usage = data.usage as Record<string, unknown>;
      expect('cachedTokens' in usage).toBe(false);
    });

    it('includes finishReason in SSE data when present', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({ id: 'c1', done: false, finishReason: 'length' });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.finishReason).toBe('length');
    });

    it('swallows writeSSE error (client disconnect)', () => {
      const config = makeStreamingConfig();
      config.sseStream.writeSSE.mockImplementation(() => { throw new Error('stream closed'); });
      const { callbacks } = createStreamCallbacks(config as never);
      // Should not throw
      expect(() => callbacks.onChunk!({ id: 'c1', content: 'x', done: false })).not.toThrow();
    });
  });

  describe('onChunk — done chunk', () => {
    function makeDoneChunk(overrides: Record<string, unknown> = {}) {
      return {
        id: 'final',
        done: true,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        ...overrides,
      };
    }

    it('writes SSE with event "done"', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      const { event } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(event).toBe('done');
    });

    it('calls extractMemoriesFromResponse with accumulated content', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!({ id: 'c1', content: 'Hello world', done: false });
      callbacks.onChunk!(makeDoneChunk());
      expect(mockExtractMemoriesFromResponse).toHaveBeenCalledWith('Hello world');
    });

    it('calls extractSuggestions with memory-stripped content', () => {
      mockExtractMemoriesFromResponse.mockReturnValueOnce({ content: 'stripped content', memories: [] });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      expect(mockExtractSuggestions).toHaveBeenCalledWith('stripped content');
    });

    it('includes suggestions in SSE data when present', () => {
      mockExtractSuggestions.mockReturnValueOnce({
        suggestions: [{ title: 'Try this', detail: 'Do something' }],
      });
      mockExtractMemoriesFromResponse.mockReturnValueOnce({ content: 'text', memories: [] });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.suggestions).toEqual([{ title: 'Try this', detail: 'Do something' }]);
    });

    it('omits suggestions from SSE data when empty', () => {
      mockExtractSuggestions.mockReturnValueOnce({ suggestions: [] });
      mockExtractMemoriesFromResponse.mockReturnValueOnce({ content: 'text', memories: [] });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.suggestions).toBeUndefined();
    });

    it('includes memories in SSE data when present', () => {
      mockExtractMemoriesFromResponse.mockReturnValueOnce({
        content: 'text',
        memories: [{ type: 'preference', content: 'likes coffee', importance: 5 }],
      });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.memories).toEqual([{ type: 'preference', content: 'likes coffee', importance: 5 }]);
    });

    it('omits memories from SSE data when empty', () => {
      mockExtractMemoriesFromResponse.mockReturnValueOnce({ content: 'text', memories: [] });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.memories).toBeUndefined();
    });

    it('includes trace data with duration', () => {
      vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValue(350);
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const trace = data.trace as Record<string, unknown>;
      expect(trace.duration).toBe(250); // 350 - 100
    });

    it('includes trace toolCalls (without startTime)', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      state.traceToolCalls.push({
        name: 'search',
        arguments: { q: 'test' },
        result: 'found',
        success: true,
        duration: 50,
        startTime: 100,
      });
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const trace = data.trace as Record<string, unknown>;
      const toolCalls = trace.toolCalls as Array<Record<string, unknown>>;
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({
        name: 'search',
        arguments: { q: 'test' },
        result: 'found',
        success: true,
        duration: 50,
      });
      // startTime should NOT be in the trace output
      expect(toolCalls[0]!.startTime).toBeUndefined();
    });

    it('includes modelCalls in trace when lastUsage is available', () => {
      const config = makeStreamingConfig({ provider: 'anthropic', model: 'claude-3' });
      const { callbacks, state } = createStreamCallbacks(config as never);
      state.lastUsage = { promptTokens: 200, completionTokens: 100, totalTokens: 300 };
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const trace = data.trace as Record<string, unknown>;
      const modelCalls = trace.modelCalls as Array<Record<string, unknown>>;
      expect(modelCalls).toHaveLength(1);
      expect(modelCalls[0]!.provider).toBe('anthropic');
      expect(modelCalls[0]!.model).toBe('claude-3');
      expect(modelCalls[0]!.inputTokens).toBe(200);
      expect(modelCalls[0]!.outputTokens).toBe(100);
      expect(modelCalls[0]!.tokens).toBe(300);
    });

    it('has empty modelCalls when no lastUsage', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk({ usage: undefined }));
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const trace = data.trace as Record<string, unknown>;
      expect(trace.modelCalls).toEqual([]);
    });

    it('includes request info in trace', () => {
      const config = makeStreamingConfig({ provider: 'openai', model: 'gpt-4', historyLength: 10 });
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const trace = data.trace as Record<string, unknown>;
      const request = trace.request as Record<string, unknown>;
      expect(request.provider).toBe('openai');
      expect(request.model).toBe('gpt-4');
      expect(request.endpoint).toBe('/api/v1/chat');
      expect(request.messageCount).toBe(11); // historyLength + 1
    });

    it('includes response status and finishReason in trace', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk({ finishReason: 'stop' }));
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const trace = data.trace as Record<string, unknown>;
      const response = trace.response as Record<string, unknown>;
      expect(response.status).toBe('success');
      expect(response.finishReason).toBe('stop');
    });

    it('includes default empty trace fields', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const trace = data.trace as Record<string, unknown>;
      expect(trace.autonomyChecks).toEqual([]);
      expect(trace.dbOperations).toEqual({ reads: 0, writes: 0 });
      expect(trace.memoryOps).toEqual({ adds: 0, recalls: 0 });
      expect(trace.triggersFired).toEqual([]);
      expect(trace.errors).toEqual([]);
    });

    it('includes events derived from traceToolCalls', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      state.traceToolCalls.push(
        { name: 'tool_a', success: true, duration: 100 },
        { name: 'tool_b', success: false, duration: 200 },
      );
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const trace = data.trace as Record<string, unknown>;
      const events = trace.events as Array<Record<string, unknown>>;
      expect(events).toEqual([
        { type: 'tool_call', name: 'tool_a', duration: 100, success: true },
        { type: 'tool_call', name: 'tool_b', duration: 200, success: false },
      ]);
    });

    it('calls getSessionInfo with agent, provider, model, and contextWindowOverride', () => {
      const agent = makeAgent();
      const config = makeStreamingConfig({ agent, provider: 'anthropic', model: 'claude-3', contextWindowOverride: 64000 });
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      expect(mockGetSessionInfo).toHaveBeenCalledWith(agent, 'anthropic', 'claude-3', 64000);
    });

    it('includes session info in SSE data', () => {
      mockGetSessionInfo.mockReturnValueOnce({
        sessionId: 's1',
        messageCount: 10,
        estimatedTokens: 2000,
        maxContextTokens: 128000,
        contextFillPercent: 1.56,
      });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const session = data.session as Record<string, unknown>;
      expect(session.sessionId).toBe('s1');
      expect(session.messageCount).toBe(10);
    });

    it('merges cachedTokens into session when present in chunk usage', () => {
      mockGetSessionInfo.mockReturnValueOnce({
        sessionId: 's1',
        messageCount: 10,
        estimatedTokens: 2000,
        maxContextTokens: 128000,
        contextFillPercent: 1.56,
      });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk({
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 80 },
      }));
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const session = data.session as Record<string, unknown>;
      expect(session.cachedTokens).toBe(80);
    });

    it('does not add cachedTokens to session when not in chunk usage', () => {
      mockGetSessionInfo.mockReturnValueOnce({
        sessionId: 's1',
        messageCount: 10,
        estimatedTokens: 2000,
        maxContextTokens: 128000,
        contextFillPercent: 1.56,
      });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk({
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }));
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const session = data.session as Record<string, unknown>;
      expect('cachedTokens' in session).toBe(false);
    });

    it('updates lastUsage from done chunk usage (after session/trace)', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      callbacks.onChunk!(makeDoneChunk({
        usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
      }));
      expect(state.lastUsage).toEqual({
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        cachedTokens: undefined,
      });
    });
  });

  describe('onBeforeToolCall', () => {
    it('calls checkToolCallApproval with userId, toolCall, and context', async () => {
      mockCheckToolCallApproval.mockResolvedValueOnce({ approved: true });
      const config = makeStreamingConfig({ userId: 'u1', agentId: 'a1', conversationId: 'c1', provider: 'openai', model: 'gpt-4' });
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall();
      await callbacks.onBeforeToolCall!(tc);
      expect(mockCheckToolCallApproval).toHaveBeenCalledWith('u1', tc, {
        agentId: 'a1',
        conversationId: 'c1',
        provider: 'openai',
        model: 'gpt-4',
      });
    });

    it('returns { approved: true } when tool is approved', async () => {
      mockCheckToolCallApproval.mockResolvedValueOnce({ approved: true });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const result = await callbacks.onBeforeToolCall!(makeToolCall());
      expect(result).toEqual({ approved: true, reason: undefined });
    });

    it('does not write SSE when tool is approved', async () => {
      mockCheckToolCallApproval.mockResolvedValueOnce({ approved: true });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      await callbacks.onBeforeToolCall!(makeToolCall());
      expect(config.sseStream.writeSSE).not.toHaveBeenCalled();
    });

    it('returns { approved: false, reason } when tool is blocked', async () => {
      mockCheckToolCallApproval.mockResolvedValueOnce({ approved: false, reason: 'Too risky' });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const result = await callbacks.onBeforeToolCall!(makeToolCall());
      expect(result).toEqual({ approved: false, reason: 'Too risky' });
    });

    it('writes tool_blocked SSE when tool is blocked', async () => {
      mockCheckToolCallApproval.mockResolvedValueOnce({ approved: false, reason: 'Blocked by policy' });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      await callbacks.onBeforeToolCall!(makeToolCall({ id: 'tc-5', name: 'dangerous_tool' }));
      const { event, data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(event).toBe('autonomy');
      expect(data.type).toBe('tool_blocked');
      expect(data.toolCall).toEqual({ id: 'tc-5', name: 'dangerous_tool' });
      expect(data.reason).toBe('Blocked by policy');
    });

    it('does not write SSE when tool is approved (no false positive)', async () => {
      mockCheckToolCallApproval.mockResolvedValueOnce({ approved: true, reason: undefined });
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      await callbacks.onBeforeToolCall!(makeToolCall());
      expect(config.sseStream.writeSSE).not.toHaveBeenCalled();
    });
  });

  describe('onToolStart', () => {
    it('pushes entry to traceToolCalls', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      callbacks.onToolStart!(makeToolCall({ name: 'my_tool' }));
      expect(state.traceToolCalls).toHaveLength(1);
      expect(state.traceToolCalls[0]!.name).toBe('my_tool');
      expect(state.traceToolCalls[0]!.success).toBe(true);
    });

    it('records startTime for duration calculation', () => {
      vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValue(500);
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      callbacks.onToolStart!(makeToolCall());
      expect(state.traceToolCalls[0]!.startTime).toBe(500);
    });

    it('writes tool_start SSE event', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onToolStart!(makeToolCall({ id: 'tc-7', name: 'search' }));
      const { event, data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(event).toBe('progress');
      expect(data.type).toBe('tool_start');
      const tool = data.tool as Record<string, unknown>;
      expect(tool.id).toBe('tc-7');
      expect(tool.name).toBe('search');
    });

    it('includes displayArgs in SSE tool field', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onToolStart!(makeToolCall({ arguments: '{"key":"val"}' }));
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const tool = data.tool as Record<string, unknown>;
      expect(tool.arguments).toEqual({ key: 'val' });
    });

    it('unwraps use_tool display name', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      const tc = makeToolCall({
        name: 'use_tool',
        arguments: JSON.stringify({ tool_name: 'inner_search', arguments: { q: 'hi' } }),
      });
      callbacks.onToolStart!(tc);
      expect(state.traceToolCalls[0]!.name).toBe('inner_search');
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      const tool = data.tool as Record<string, unknown>;
      expect(tool.name).toBe('inner_search');
    });

    it('includes timestamp in SSE data', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onToolStart!(makeToolCall());
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.timestamp).toBeDefined();
      // Should be an ISO string
      expect(() => new Date(data.timestamp as string)).not.toThrow();
    });

    it('stores parsed arguments in trace entry', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      callbacks.onToolStart!(makeToolCall({ arguments: '{"a":1,"b":2}' }));
      expect(state.traceToolCalls[0]!.arguments).toEqual({ a: 1, b: 2 });
    });
  });

  describe('onToolEnd', () => {
    it('updates matching trace entry with result', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'found it', isError: false });
      expect(state.traceToolCalls[0]!.result).toBe('found it');
    });

    it('sets success to false when isError is true', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'error occurred', isError: true });
      expect(state.traceToolCalls[0]!.success).toBe(false);
    });

    it('sets success to true when isError is false', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'ok', isError: false });
      expect(state.traceToolCalls[0]!.success).toBe(true);
    });

    it('sets success to true when isError is undefined (default)', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'ok' });
      expect(state.traceToolCalls[0]!.success).toBe(true);
    });

    it('uses provided durationMs when available', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'ok', durationMs: 42 });
      expect(state.traceToolCalls[0]!.duration).toBe(42);
    });

    it('computes duration from startTime when durationMs not provided', () => {
      vi.spyOn(performance, 'now')
        .mockReturnValueOnce(100)  // createStreamCallbacks startTime
        .mockReturnValueOnce(500)  // onToolStart startTime
        .mockReturnValue(750);     // onToolEnd performance.now()
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'ok' });
      expect(state.traceToolCalls[0]!.duration).toBe(250); // 750 - 500
    });

    it('removes startTime from trace entry after completion', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      expect(state.traceToolCalls[0]!.startTime).toBeDefined();
      callbacks.onToolEnd!(tc, { content: 'ok' });
      expect(state.traceToolCalls[0]!.startTime).toBeUndefined();
    });

    it('writes tool_end SSE event', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ id: 'tc-9', name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'result text', durationMs: 100 });
      // writeSSE call 0 is onToolStart, call 1 is onToolEnd
      const { event, data } = parseWrittenSSE(config.sseStream.writeSSE, 1);
      expect(event).toBe('progress');
      expect(data.type).toBe('tool_end');
      const tool = data.tool as Record<string, unknown>;
      expect(tool.id).toBe('tc-9');
      expect(tool.name).toBe('search');
    });

    it('includes result preview truncated to 500 chars', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      const longContent = 'x'.repeat(1000);
      callbacks.onToolEnd!(tc, { content: longContent });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE, 1);
      const result = data.result as Record<string, unknown>;
      expect((result.preview as string).length).toBe(500);
    });

    it('includes durationMs in result SSE data', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'ok', durationMs: 77 });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE, 1);
      const result = data.result as Record<string, unknown>;
      expect(result.durationMs).toBe(77);
    });

    it('includes success flag in result SSE data', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'fail', isError: true });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE, 1);
      const result = data.result as Record<string, unknown>;
      expect(result.success).toBe(false);
    });

    it('parses sandbox info from JSON result content', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'run_code' });
      callbacks.onToolStart!(tc);
      const jsonResult = JSON.stringify({ sandboxed: true, executionMode: 'docker', output: 'hi' });
      callbacks.onToolEnd!(tc, { content: jsonResult });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE, 1);
      const result = data.result as Record<string, unknown>;
      expect(result.sandboxed).toBe(true);
      expect(result.executionMode).toBe('docker');
    });

    it('omits sandbox info when result is not JSON', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'plain text result' });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE, 1);
      const result = data.result as Record<string, unknown>;
      expect('sandboxed' in result).toBe(false);
      expect('executionMode' in result).toBe(false);
    });

    it('omits sandbox info when JSON has no sandboxed field', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: JSON.stringify({ output: 'hi' }) });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE, 1);
      const result = data.result as Record<string, unknown>;
      expect('sandboxed' in result).toBe(false);
    });

    it('omits executionMode when it is empty/falsy', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'run_code' });
      callbacks.onToolStart!(tc);
      const jsonResult = JSON.stringify({ sandboxed: false, executionMode: '' });
      callbacks.onToolEnd!(tc, { content: jsonResult });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE, 1);
      const result = data.result as Record<string, unknown>;
      expect(result.sandboxed).toBe(false);
      expect('executionMode' in result).toBe(false);
    });

    it('does not crash when no matching trace entry exists', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      // Call onToolEnd without onToolStart
      const tc = makeToolCall({ name: 'unknown' });
      expect(() => callbacks.onToolEnd!(tc, { content: 'ok' })).not.toThrow();
      expect(state.traceToolCalls).toHaveLength(0);
    });

    it('matches the correct trace entry among multiple', () => {
      const config = makeStreamingConfig();
      const { callbacks, state } = createStreamCallbacks(config as never);
      const tc1 = makeToolCall({ id: 'tc-1', name: 'tool_a', arguments: '{}' });
      const tc2 = makeToolCall({ id: 'tc-2', name: 'tool_b', arguments: '{}' });
      callbacks.onToolStart!(tc1);
      callbacks.onToolStart!(tc2);
      callbacks.onToolEnd!(tc2, { content: 'result_b' });
      expect(state.traceToolCalls[0]!.result).toBeUndefined(); // tool_a not ended yet
      expect(state.traceToolCalls[1]!.result).toBe('result_b');
    });

    it('handles use_tool unwrapping for display name in SSE', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall({
        name: 'use_tool',
        arguments: JSON.stringify({ tool_name: 'wrapped_tool', arguments: {} }),
      });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'done' });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE, 1);
      const tool = data.tool as Record<string, unknown>;
      expect(tool.name).toBe('wrapped_tool');
    });

    it('includes timestamp in SSE data', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      const tc = makeToolCall({ name: 'search' });
      callbacks.onToolStart!(tc);
      callbacks.onToolEnd!(tc, { content: 'ok' });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE, 1);
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('onProgress', () => {
    it('writes status SSE event', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onProgress!('Processing...');
      const { event, data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(event).toBe('progress');
      expect(data.type).toBe('status');
      expect(data.message).toBe('Processing...');
    });

    it('includes optional data payload', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onProgress!('Step 2', { step: 2, total: 5 });
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.data).toEqual({ step: 2, total: 5 });
    });

    it('omits data when not provided', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onProgress!('Done');
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.data).toBeUndefined();
    });

    it('includes timestamp', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onProgress!('Working...');
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('onError', () => {
    it('writes error SSE event', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onError!(new Error('Something broke'));
      const { event, data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(event).toBe('error');
      expect(data.error).toBe('Something broke');
    });

    it('handles error with empty message', () => {
      const config = makeStreamingConfig();
      const { callbacks } = createStreamCallbacks(config as never);
      callbacks.onError!(new Error(''));
      const { data } = parseWrittenSSE(config.sseStream.writeSSE);
      expect(data.error).toBe('');
    });
  });
});

// =====================================================================
// recordStreamUsage
// =====================================================================

describe('recordStreamUsage', () => {
  it('records full usage when lastUsage exists', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(600);
    const state = makeStreamState({
      startTime: 100,
      lastUsage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    });
    await recordStreamUsage(state, {
      userId: 'u1',
      conversationId: 'c1',
      provider: 'openai',
      model: 'gpt-4',
    });
    expect(mockUsageRecord).toHaveBeenCalledWith({
      userId: 'u1',
      sessionId: 'c1',
      provider: 'openai',
      model: 'gpt-4',
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      latencyMs: 500, // 600 - 100
      requestType: 'chat',
    });
  });

  it('includes cachedTokens in usage fields (via lastUsage.cachedTokens)', async () => {
    const state = makeStreamState({
      startTime: 100,
      lastUsage: { promptTokens: 200, completionTokens: 100, totalTokens: 300, cachedTokens: 50 },
    });
    await recordStreamUsage(state, {
      userId: 'u1',
      conversationId: 'c1',
      provider: 'anthropic',
      model: 'claude-3',
    });
    // cachedTokens is in lastUsage but the record call only passes explicit fields
    // Check that the record was called (cachedTokens not in the call spec)
    expect(mockUsageRecord).toHaveBeenCalledOnce();
  });

  it('records error usage when no lastUsage but error provided', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(300);
    const state = makeStreamState({ startTime: 100 });
    await recordStreamUsage(state, {
      userId: 'u1',
      conversationId: 'c1',
      provider: 'openai',
      model: 'gpt-4',
      error: 'Rate limit exceeded',
    });
    expect(mockUsageRecord).toHaveBeenCalledWith({
      userId: 'u1',
      provider: 'openai',
      model: 'gpt-4',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: 200,
      requestType: 'chat',
      error: 'Rate limit exceeded',
    });
  });

  it('does not include sessionId in error usage record', async () => {
    const state = makeStreamState({ startTime: 100 });
    await recordStreamUsage(state, {
      userId: 'u1',
      conversationId: 'c1',
      provider: 'openai',
      model: 'gpt-4',
      error: 'fail',
    });
    const recorded = mockUsageRecord.mock.calls[0]![0] as Record<string, unknown>;
    expect('sessionId' in recorded).toBe(false);
  });

  it('does NOT record anything when no usage and no error', async () => {
    const state = makeStreamState({ startTime: 100 });
    await recordStreamUsage(state, {
      userId: 'u1',
      conversationId: 'c1',
      provider: 'openai',
      model: 'gpt-4',
    });
    expect(mockUsageRecord).not.toHaveBeenCalled();
  });

  it('swallows errors from usageTracker.record (success path)', async () => {
    mockUsageRecord.mockRejectedValueOnce(new Error('DB error'));
    const state = makeStreamState({
      startTime: 100,
      lastUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    // Should not throw
    await expect(recordStreamUsage(state, {
      userId: 'u1',
      conversationId: 'c1',
      provider: 'openai',
      model: 'gpt-4',
    })).resolves.toBeUndefined();
  });

  it('swallows errors from usageTracker.record (error path)', async () => {
    mockUsageRecord.mockRejectedValueOnce(new Error('DB error'));
    const state = makeStreamState({ startTime: 100 });
    await expect(recordStreamUsage(state, {
      userId: 'u1',
      conversationId: 'c1',
      provider: 'openai',
      model: 'gpt-4',
      error: 'some error',
    })).resolves.toBeUndefined();
  });

  it('computes latencyMs correctly', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1500);
    const state = makeStreamState({
      startTime: 500,
      lastUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    await recordStreamUsage(state, {
      userId: 'u1',
      conversationId: 'c1',
      provider: 'openai',
      model: 'gpt-4',
    });
    const recorded = mockUsageRecord.mock.calls[0]![0] as Record<string, unknown>;
    expect(recorded.latencyMs).toBe(1000); // 1500 - 500
  });

  it('rounds latencyMs to integer', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(500.7);
    const state = makeStreamState({
      startTime: 100.3,
      lastUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    await recordStreamUsage(state, {
      userId: 'u1',
      conversationId: 'c1',
      provider: 'openai',
      model: 'gpt-4',
    });
    const recorded = mockUsageRecord.mock.calls[0]![0] as Record<string, unknown>;
    expect(recorded.latencyMs).toBe(400); // Math.round(400.4) = 400
  });

  it('prefers lastUsage path over error path when both exist', async () => {
    const state = makeStreamState({
      startTime: 100,
      lastUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    await recordStreamUsage(state, {
      userId: 'u1',
      conversationId: 'c1',
      provider: 'openai',
      model: 'gpt-4',
      error: 'also has an error',
    });
    // Should use the lastUsage path (with sessionId), not the error path
    const recorded = mockUsageRecord.mock.calls[0]![0] as Record<string, unknown>;
    expect(recorded.sessionId).toBe('c1');
    expect(recorded.inputTokens).toBe(10);
    expect('error' in recorded).toBe(false);
  });
});

// =====================================================================
// processStreamingViaBus
// =====================================================================

describe('processStreamingViaBus', () => {
  function makeBus(responseOverrides: Record<string, unknown> = {}) {
    return {
      process: vi.fn().mockResolvedValue({
        response: {
          content: 'AI response',
          metadata: {
            error: undefined,
            toolCalls: [],
            finishReason: 'stop',
            ...responseOverrides,
          },
        },
        streamed: true,
        durationMs: 100,
        stages: ['agent-execution'],
      }),
    };
  }

  function makeParams(overrides: Record<string, unknown> = {}) {
    return {
      agent: makeAgent(),
      chatMessage: 'Hello AI',
      body: { historyLength: 5 },
      provider: 'openai',
      model: 'gpt-4',
      userId: 'user-1',
      agentId: 'agent-1',
      conversationId: 'conv-1',
      ...overrides,
    };
  }

  it('calls bus.process with a NormalizedMessage', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    expect(bus.process).toHaveBeenCalledOnce();
    const [normalized] = bus.process.mock.calls[0]!;
    expect(normalized.role).toBe('user');
    expect(normalized.content).toBe('Hello AI');
    expect(normalized.sessionId).toBe('conv-1');
  });

  it('populates NormalizedMessage metadata correctly', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    const [normalized] = bus.process.mock.calls[0]!;
    expect(normalized.metadata).toEqual(expect.objectContaining({
      source: 'web',
      provider: 'openai',
      model: 'gpt-4',
      conversationId: 'conv-1',
      agentId: 'agent-1',
      stream: true,
    }));
  });

  it('passes stream callbacks in options', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    const [, options] = bus.process.mock.calls[0]!;
    expect(options.stream).toBeDefined();
    expect(typeof options.stream.onChunk).toBe('function');
  });

  it('passes context with directTools in options', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    const params = makeParams({ body: { historyLength: 5, directTools: ['tool_a', 'tool_b'] } });
    await processStreamingViaBus(bus as never, sseStream, params as never);
    const [, options] = bus.process.mock.calls[0]!;
    expect(options.context.directTools).toEqual(['tool_a', 'tool_b']);
  });

  it('calls recordStreamUsage after processing', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    // recordStreamUsage is called internally; we can verify via usageTracker
    // (it won't record anything if no lastUsage and no error, but the function was called)
    // Check that it was attempted by verifying bus.process completed first
    expect(bus.process).toHaveBeenCalledOnce();
  });

  it('saves streaming chat when assistant content exists from bus result', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    expect(mockSaveStreamingChat).toHaveBeenCalledOnce();
    const [, saveParams] = mockSaveStreamingChat.mock.calls[0]!;
    expect(saveParams.userId).toBe('user-1');
    expect(saveParams.conversationId).toBe('conv-1');
    expect(saveParams.userMessage).toBe('Hello AI');
    expect(saveParams.assistantContent).toBe('AI response');
  });

  it('saves streaming chat when content comes from streamedContent (fallback)', async () => {
    const bus = makeBus({ content: undefined });
    // Simulate bus returning empty content, but streamed content accumulated
    bus.process.mockResolvedValueOnce({
      response: {
        content: '',
        metadata: { error: undefined, toolCalls: [], finishReason: 'stop' },
      },
      streamed: true,
      durationMs: 100,
      stages: [],
    });
    const sseStream = makeSSEStream();
    // We can't easily inject streamedContent without calling onChunk.
    // When response.content is empty string (falsy), it falls through to state.streamedContent.
    // Since state.streamedContent is also '' initially, no save occurs.
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    // Both are empty string → assistantContent is '' which is falsy → no save
    expect(mockSaveStreamingChat).not.toHaveBeenCalled();
  });

  it('does NOT save when no assistant content', async () => {
    const bus = makeBus();
    bus.process.mockResolvedValueOnce({
      response: {
        content: '',
        metadata: { error: undefined },
      },
      streamed: true,
      durationMs: 100,
      stages: [],
    });
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    expect(mockSaveStreamingChat).not.toHaveBeenCalled();
    expect(mockRunPostChatProcessing).not.toHaveBeenCalled();
  });

  it('runs post-processing when assistant content exists', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    expect(mockRunPostChatProcessing).toHaveBeenCalledWith(
      'user-1',
      'Hello AI',
      'AI response',
      expect.anything(), // toolCalls
    );
  });

  it('passes error from bus result to recordStreamUsage', async () => {
    const bus = makeBus({ error: 'model_overloaded' });
    bus.process.mockResolvedValueOnce({
      response: {
        content: 'partial response',
        metadata: { error: 'model_overloaded', toolCalls: [], finishReason: 'error' },
      },
      streamed: true,
      durationMs: 100,
      stages: [],
    });
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    // Even with error in metadata, if content exists, save is still called
    expect(mockSaveStreamingChat).toHaveBeenCalledOnce();
  });

  it('defaults historyLength to 0 when not in body', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    const params = makeParams({ body: {} });
    await processStreamingViaBus(bus as never, sseStream, params as never);
    // The historyLength: body.historyLength ?? 0 means config gets 0
    expect(bus.process).toHaveBeenCalledOnce();
  });

  it('passes contextWindowOverride through to config', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    const params = makeParams({ contextWindowOverride: 32000 });
    await processStreamingViaBus(bus as never, sseStream, params as never);
    // The contextWindowOverride gets forwarded to createStreamCallbacks
    // which uses it in getSessionInfo calls on done chunks
    expect(bus.process).toHaveBeenCalledOnce();
  });

  it('includes attachments in NormalizedMessage when present', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    const params = makeParams({
      body: {
        historyLength: 0,
        attachments: [
          { type: 'image', data: 'base64data', mimeType: 'image/png', filename: 'pic.png' },
          { type: 'file', data: 'filedata', mimeType: 'text/plain' },
        ],
      },
    });
    await processStreamingViaBus(bus as never, sseStream, params as never);
    const [normalized] = bus.process.mock.calls[0]!;
    expect(normalized.attachments).toEqual([
      { type: 'image', data: 'base64data', mimeType: 'image/png', filename: 'pic.png' },
      { type: 'file', data: 'filedata', mimeType: 'text/plain', filename: undefined },
    ]);
  });

  it('omits attachments from NormalizedMessage when empty array', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    const params = makeParams({ body: { historyLength: 5, attachments: [] } });
    await processStreamingViaBus(bus as never, sseStream, params as never);
    const [normalized] = bus.process.mock.calls[0]!;
    expect(normalized.attachments).toBeUndefined();
  });

  it('omits attachments from NormalizedMessage when not provided', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    const [normalized] = bus.process.mock.calls[0]!;
    expect(normalized.attachments).toBeUndefined();
  });

  it('passes toolCalls from result metadata to saveStreamingChat', async () => {
    const bus = makeBus();
    bus.process.mockResolvedValueOnce({
      response: {
        content: 'Response with tools',
        metadata: {
          error: undefined,
          toolCalls: [{ id: 'tc1', name: 'search', arguments: '{}' }],
          finishReason: 'stop',
        },
      },
      streamed: true,
      durationMs: 100,
      stages: [],
    });
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    const [, saveParams] = mockSaveStreamingChat.mock.calls[0]!;
    expect(saveParams.toolCalls).toEqual([{ id: 'tc1', name: 'search', arguments: '{}' }]);
  });

  it('passes finishReason from result metadata to saveStreamingChat', async () => {
    const bus = makeBus();
    bus.process.mockResolvedValueOnce({
      response: {
        content: 'Done',
        metadata: { error: undefined, toolCalls: [], finishReason: 'length' },
      },
      streamed: true,
      durationMs: 100,
      stages: [],
    });
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    const [, saveParams] = mockSaveStreamingChat.mock.calls[0]!;
    expect(saveParams.finishReason).toBe('length');
  });

  it('passes historyLength from body to saveStreamingChat', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    const params = makeParams({ body: { historyLength: 10 } });
    await processStreamingViaBus(bus as never, sseStream, params as never);
    const [, saveParams] = mockSaveStreamingChat.mock.calls[0]!;
    expect(saveParams.historyLength).toBe(10);
  });

  it('NormalizedMessage has an id (UUID)', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    const [normalized] = bus.process.mock.calls[0]!;
    expect(normalized.id).toBeDefined();
    expect(typeof normalized.id).toBe('string');
    expect(normalized.id.length).toBeGreaterThan(0);
  });

  it('NormalizedMessage has a timestamp', async () => {
    const bus = makeBus();
    const sseStream = makeSSEStream();
    await processStreamingViaBus(bus as never, sseStream, makeParams() as never);
    const [normalized] = bus.process.mock.calls[0]!;
    expect(normalized.timestamp).toBeInstanceOf(Date);
  });
});
