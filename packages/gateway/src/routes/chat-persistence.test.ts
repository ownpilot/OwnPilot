import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before dynamic import so the factory closures capture them
// ---------------------------------------------------------------------------

const mockChatRepo = {
  getOrCreateConversation: vi.fn(),
  addMessage: vi.fn(),
};

const mockLogsRepo = {
  log: vi.fn(),
};

const mockBroadcast = vi.fn();
const mockExtractMemories = vi.fn().mockResolvedValue(0);
const mockUpdateGoalProgress = vi.fn().mockResolvedValue(undefined);
const mockEvaluateTriggers = vi.fn().mockResolvedValue(undefined);
const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('../db/repositories/index.js', () => ({
  ChatRepository: vi.fn(function () { return mockChatRepo; }),
  LogsRepository: vi.fn(function () { return mockLogsRepo; }),
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: mockBroadcast },
}));

vi.mock('../services/log.js', () => ({
  getLog: () => mockLog,
}));

vi.mock('./helpers.js', () => ({
  truncate: vi.fn((text: string) => text?.slice(0, 50)),
  getErrorMessage: vi.fn((err: unknown) => err instanceof Error ? err.message : String(err)),
}));

vi.mock('../assistant/index.js', () => ({
  extractMemories: (...args: unknown[]) => mockExtractMemories(...args),
  updateGoalProgress: (...args: unknown[]) => mockUpdateGoalProgress(...args),
  evaluateTriggers: (...args: unknown[]) => mockEvaluateTriggers(...args),
}));

vi.mock('@ownpilot/core', () => ({
  debugLog: { getRecent: vi.fn().mockReturnValue([]) },
}));

// Dynamic import AFTER vi.mock calls so the mocked modules are in place
const { broadcastChatUpdate, saveChatToDatabase, saveStreamingChat, runPostChatProcessing } =
  await import('./chat-persistence.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush the micro-task / macro-task queue several times. */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

/** Build a minimal StreamState for saveStreamingChat tests. */
function makeStreamState(overrides: Record<string, unknown> = {}) {
  return {
    startTime: 500,
    traceToolCalls: [] as Array<{
      name: string;
      arguments?: Record<string, unknown>;
      result?: string;
      success: boolean;
      duration?: number;
      startTime?: number;
    }>,
    lastUsage: null as null | { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number },
    streamedContent: '',
    ...overrides,
  };
}

/** Minimal conversation row returned by getOrCreateConversation. */
function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    title: 'Hello world',
    messageCount: 3,
    ...overrides,
  };
}

/** Minimal SaveChatParams for saveChatToDatabase tests. */
function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    conversationId: 'conv-1',
    provider: 'openai',
    model: 'gpt-4o',
    userMessage: 'Hello',
    assistantContent: 'Hi there!',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('broadcastChatUpdate', () => {
  beforeEach(() => {
    mockBroadcast.mockReset();
  });

  it('broadcasts with the correct event name', () => {
    broadcastChatUpdate({ id: 'conv-1', title: 'Test', messageCount: 0 });

    expect(mockBroadcast).toHaveBeenCalledOnce();
    expect(mockBroadcast.mock.calls[0]![0]).toBe('chat:history:updated');
  });

  it('messageCount in broadcast payload is original count + 2', () => {
    broadcastChatUpdate({ id: 'conv-1', title: 'Test', messageCount: 5 });

    const payload = mockBroadcast.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.messageCount).toBe(7);
  });

  it('source is always "web"', () => {
    broadcastChatUpdate({ id: 'conv-1', title: 'Test', messageCount: 0 });

    const payload = mockBroadcast.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.source).toBe('web');
  });

  it('title defaults to empty string when null', () => {
    broadcastChatUpdate({ id: 'conv-1', title: null, messageCount: 0 });

    const payload = mockBroadcast.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.title).toBe('');
  });

  it('title is preserved when provided', () => {
    broadcastChatUpdate({ id: 'conv-1', title: 'My conversation', messageCount: 0 });

    const payload = mockBroadcast.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.title).toBe('My conversation');
  });

  it('conversationId is forwarded correctly', () => {
    broadcastChatUpdate({ id: 'abc-123', title: 'X', messageCount: 0 });

    const payload = mockBroadcast.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.conversationId).toBe('abc-123');
  });
});

// ---------------------------------------------------------------------------

describe('saveChatToDatabase', () => {
  beforeEach(() => {
    mockChatRepo.getOrCreateConversation.mockReset();
    mockChatRepo.addMessage.mockReset();
    mockLogsRepo.log.mockReset();
    mockBroadcast.mockReset();
    mockLog.info.mockReset();
    mockLog.warn.mockReset();

    // Default happy-path conversation
    mockChatRepo.getOrCreateConversation.mockResolvedValue(makeConversation());
    mockChatRepo.addMessage.mockResolvedValue(undefined);
  });

  it('creates ChatRepository with the correct userId', async () => {
    const { ChatRepository } = await import('../db/repositories/index.js');
    await saveChatToDatabase(makeParams({ userId: 'user-42' }));

    expect(ChatRepository).toHaveBeenCalledWith('user-42');
  });

  it('calls getOrCreateConversation with conversationId and metadata', async () => {
    await saveChatToDatabase(makeParams({
      conversationId: 'conv-99',
      provider: 'anthropic',
      model: 'claude-3',
      userMessage: 'Hello from test',
    }));

    expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith(
      'conv-99',
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-3',
      }),
    );
  });

  it('adds a user message with correct fields', async () => {
    await saveChatToDatabase(makeParams({
      userMessage: 'User input',
      provider: 'openai',
      model: 'gpt-4o',
    }));

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const userCall = calls.find(([args]) => args.role === 'user');
    expect(userCall).toBeDefined();
    expect(userCall![0]).toMatchObject({
      conversationId: 'conv-1',
      role: 'user',
      content: 'User input',
      provider: 'openai',
      model: 'gpt-4o',
    });
  });

  it('adds an assistant message with correct fields', async () => {
    await saveChatToDatabase(makeParams({
      assistantContent: 'Assistant reply',
      provider: 'openai',
      model: 'gpt-4o',
    }));

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const assistantCall = calls.find(([args]) => args.role === 'assistant');
    expect(assistantCall).toBeDefined();
    expect(assistantCall![0]).toMatchObject({
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Assistant reply',
      provider: 'openai',
      model: 'gpt-4o',
    });
  });

  it('adds toolCalls as a shallow copy to the assistant message', async () => {
    const toolCalls = [{ name: 'search', arguments: '{}' }];
    await saveChatToDatabase(makeParams({ toolCalls }));

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const assistantCall = calls.find(([args]) => args.role === 'assistant')!;
    expect(assistantCall[0].toolCalls).toEqual(toolCalls);
    // Shallow copy — different reference
    expect(assistantCall[0].toolCalls).not.toBe(toolCalls);
  });

  it('adds trace info to the assistant message', async () => {
    const trace = { duration: 1234, modelCalls: [] };
    await saveChatToDatabase(makeParams({ trace }));

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const assistantCall = calls.find(([args]) => args.role === 'assistant')!;
    expect(assistantCall[0].trace).toEqual(trace);
  });

  it('adds inputTokens and outputTokens from usage', async () => {
    await saveChatToDatabase(makeParams({
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    }));

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const assistantCall = calls.find(([args]) => args.role === 'assistant')!;
    expect(assistantCall[0].inputTokens).toBe(100);
    expect(assistantCall[0].outputTokens).toBe(200);
  });

  it('calls LogsRepository.log with the full parameters', async () => {
    await saveChatToDatabase(makeParams({
      provider: 'openai',
      model: 'gpt-4o',
      userMessage: 'Hello',
      assistantContent: 'World',
      historyLength: 5,
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }));

    expect(mockLogsRepo.log).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        type: 'chat',
        provider: 'openai',
        model: 'gpt-4o',
        endpoint: 'chat/completions',
        method: 'POST',
        statusCode: 200,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
      }),
    );
  });

  it('broadcasts on success', async () => {
    await saveChatToDatabase(makeParams());

    expect(mockBroadcast).toHaveBeenCalledOnce();
  });

  it('does NOT throw when an error occurs', async () => {
    mockChatRepo.getOrCreateConversation.mockRejectedValue(new Error('DB down'));

    await expect(saveChatToDatabase(makeParams())).resolves.toBeUndefined();
  });

  it('logs a warning when an error occurs', async () => {
    mockChatRepo.getOrCreateConversation.mockRejectedValue(new Error('DB down'));

    await saveChatToDatabase(makeParams());

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to save'),
      expect.any(Error),
    );
  });

  it('passes attachments to the user message when present', async () => {
    const attachments = [{ type: 'image' as const, mimeType: 'image/png', filename: 'photo.png', size: 1024 }];
    await saveChatToDatabase(makeParams({ attachments }));

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const userCall = calls.find(([args]) => args.role === 'user')!;
    expect(userCall[0].attachments).toEqual(attachments);
  });

  it('omits attachments from user message when array is empty', async () => {
    await saveChatToDatabase(makeParams({ attachments: [] }));

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const userCall = calls.find(([args]) => args.role === 'user')!;
    expect(userCall[0]).not.toHaveProperty('attachments');
  });

  it('uses agentName "Chat" when no agentId is provided', async () => {
    await saveChatToDatabase(makeParams());  // no agentId

    expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ agentName: 'Chat' }),
    );
  });

  it('uses undefined agentName when agentId is present', async () => {
    await saveChatToDatabase(makeParams({ agentId: 'agent-42' }));

    expect(mockChatRepo.getOrCreateConversation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ agentName: undefined, agentId: 'agent-42' }),
    );
  });

  it('includes streaming flag in the log requestBody when streaming=true', async () => {
    await saveChatToDatabase(makeParams({ streaming: true }));

    const logCall = mockLogsRepo.log.mock.calls[0]![0] as Record<string, unknown>;
    const requestBody = logCall.requestBody as Record<string, unknown>;
    expect(requestBody.streaming).toBe(true);
  });

  it('omits streaming flag from log requestBody when streaming is not set', async () => {
    await saveChatToDatabase(makeParams());  // no streaming

    const logCall = mockLogsRepo.log.mock.calls[0]![0] as Record<string, unknown>;
    const requestBody = logCall.requestBody as Record<string, unknown>;
    expect(requestBody).not.toHaveProperty('streaming');
  });
});

// ---------------------------------------------------------------------------

describe('saveStreamingChat', () => {
  beforeEach(() => {
    mockChatRepo.getOrCreateConversation.mockReset();
    mockChatRepo.addMessage.mockReset();
    mockLogsRepo.log.mockReset();
    mockBroadcast.mockReset();
    mockLog.info.mockReset();

    mockChatRepo.getOrCreateConversation.mockResolvedValue(makeConversation());
    mockChatRepo.addMessage.mockResolvedValue(undefined);

    vi.spyOn(performance, 'now').mockReturnValue(1000);
  });

  it('builds a trace with stream latency equal to performance.now() - startTime', async () => {
    // performance.now() returns 1000, startTime = 500 → latency = 500
    const state = makeStreamState({ startTime: 500 });
    await saveStreamingChat(state as Parameters<typeof saveStreamingChat>[0], {
      userId: 'user-1',
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-4o',
      userMessage: 'Hello',
      assistantContent: 'Hi!',
    });

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const assistantCall = calls.find(([args]) => args.role === 'assistant')!;
    const trace = assistantCall[0].trace as Record<string, unknown>;
    expect(trace.duration).toBe(500);
  });

  it('calls saveChatToDatabase with streaming=true', async () => {
    const state = makeStreamState();
    await saveStreamingChat(state as Parameters<typeof saveStreamingChat>[0], {
      userId: 'user-1',
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-4o',
      userMessage: 'Hello',
      assistantContent: 'Hi!',
    });

    // Verified via the log message that includes "streaming"
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('streaming'),
    );
  });

  it('populates usage from state.lastUsage when present', async () => {
    const state = makeStreamState({
      lastUsage: { promptTokens: 50, completionTokens: 75, totalTokens: 125, cachedTokens: 10 },
    });
    await saveStreamingChat(state as Parameters<typeof saveStreamingChat>[0], {
      userId: 'user-1',
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-4o',
      userMessage: 'Hello',
      assistantContent: 'Hi!',
    });

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const assistantCall = calls.find(([args]) => args.role === 'assistant')!;
    expect(assistantCall[0].inputTokens).toBe(50);
    expect(assistantCall[0].outputTokens).toBe(75);
  });

  it('handles missing lastUsage (null) without throwing', async () => {
    const state = makeStreamState({ lastUsage: null });
    await expect(
      saveStreamingChat(state as Parameters<typeof saveStreamingChat>[0], {
        userId: 'user-1',
        conversationId: 'conv-1',
        provider: 'openai',
        model: 'gpt-4o',
        userMessage: 'Hello',
        assistantContent: 'Hi!',
      })
    ).resolves.toBeUndefined();
  });

  it('builds modelCalls array with usage data when lastUsage is present', async () => {
    const state = makeStreamState({
      lastUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    });
    await saveStreamingChat(state as Parameters<typeof saveStreamingChat>[0], {
      userId: 'user-1',
      conversationId: 'conv-1',
      provider: 'anthropic',
      model: 'claude-3',
      userMessage: 'Hello',
      assistantContent: 'Hi!',
    });

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const assistantCall = calls.find(([args]) => args.role === 'assistant')!;
    const trace = assistantCall[0].trace as Record<string, unknown>;
    const modelCalls = trace.modelCalls as Array<Record<string, unknown>>;
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-3',
      inputTokens: 10,
      outputTokens: 20,
      tokens: 30,
    });
  });

  it('produces empty modelCalls array when lastUsage is null', async () => {
    const state = makeStreamState({ lastUsage: null });
    await saveStreamingChat(state as Parameters<typeof saveStreamingChat>[0], {
      userId: 'user-1',
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-4o',
      userMessage: 'Hello',
      assistantContent: 'Hi!',
    });

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const assistantCall = calls.find(([args]) => args.role === 'assistant')!;
    const trace = assistantCall[0].trace as Record<string, unknown>;
    const modelCalls = trace.modelCalls as unknown[];
    expect(modelCalls).toHaveLength(0);
  });

  it('maps traceToolCalls into the trace', async () => {
    const state = makeStreamState({
      traceToolCalls: [
        { name: 'search', arguments: { q: 'test' }, result: 'results', success: true, duration: 120 },
      ],
    });
    await saveStreamingChat(state as Parameters<typeof saveStreamingChat>[0], {
      userId: 'user-1',
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-4o',
      userMessage: 'Hello',
      assistantContent: 'Hi!',
    });

    const calls = mockChatRepo.addMessage.mock.calls as Array<[Record<string, unknown>]>;
    const assistantCall = calls.find(([args]) => args.role === 'assistant')!;
    const trace = assistantCall[0].trace as Record<string, unknown>;
    const tracedCalls = trace.toolCalls as Array<Record<string, unknown>>;
    expect(tracedCalls).toHaveLength(1);
    expect(tracedCalls[0]).toMatchObject({ name: 'search', success: true, duration: 120 });
  });
});

// ---------------------------------------------------------------------------

describe('runPostChatProcessing', () => {
  beforeEach(() => {
    mockExtractMemories.mockReset();
    mockUpdateGoalProgress.mockReset();
    mockEvaluateTriggers.mockReset();
    mockLog.info.mockReset();
    mockLog.warn.mockReset();
    mockLog.error.mockReset();

    mockExtractMemories.mockResolvedValue(0);
    mockUpdateGoalProgress.mockResolvedValue(undefined);
    mockEvaluateTriggers.mockResolvedValue(undefined);
  });

  it('calls extractMemories, updateGoalProgress, and evaluateTriggers', async () => {
    runPostChatProcessing('user-1', 'Hello', 'Hi');
    await flushPromises();

    expect(mockExtractMemories).toHaveBeenCalledWith('user-1', 'Hello', 'Hi');
    expect(mockUpdateGoalProgress).toHaveBeenCalledWith('user-1', 'Hello', 'Hi', undefined);
    expect(mockEvaluateTriggers).toHaveBeenCalledWith('user-1', 'Hello', 'Hi');
  });

  it('passes toolCalls to updateGoalProgress', async () => {
    const toolCalls = [{ id: 'tc-1', name: 'search', arguments: '{}' }] as Parameters<typeof runPostChatProcessing>[3];
    runPostChatProcessing('user-1', 'Hello', 'Hi', toolCalls);
    await flushPromises();

    expect(mockUpdateGoalProgress).toHaveBeenCalledWith('user-1', 'Hello', 'Hi', toolCalls);
  });

  it('handles extractMemories failure gracefully (logs warn, does not throw)', async () => {
    mockExtractMemories.mockRejectedValue(new Error('memory error'));

    runPostChatProcessing('user-1', 'Hello', 'Hi');
    await flushPromises();

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Memory extraction failed'),
      expect.any(Error),
    );
  });

  it('handles all three functions failing simultaneously', async () => {
    mockExtractMemories.mockRejectedValue(new Error('memory error'));
    mockUpdateGoalProgress.mockRejectedValue(new Error('goal error'));
    mockEvaluateTriggers.mockRejectedValue(new Error('trigger error'));

    runPostChatProcessing('user-1', 'Hello', 'Hi');
    await flushPromises();

    expect(mockLog.warn).toHaveBeenCalledTimes(3);
  });

  it('logs memory count when extractMemories returns > 0', async () => {
    mockExtractMemories.mockResolvedValue(3);

    runPostChatProcessing('user-1', 'Hello', 'Hi');
    await flushPromises();

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('3'),
    );
  });

  it('does not log when extractMemories returns 0', async () => {
    mockExtractMemories.mockResolvedValue(0);

    runPostChatProcessing('user-1', 'Hello', 'Hi');
    await flushPromises();

    const infoCalls = (mockLog.info.mock.calls as Array<[string]>).filter(
      ([msg]) => msg.includes('memor'),
    );
    expect(infoCalls).toHaveLength(0);
  });

  it('returns void immediately (fire-and-forget)', () => {
    const result = runPostChatProcessing('user-1', 'Hello', 'Hi');
    expect(result).toBeUndefined();
  });

  it('logs trigger count when evaluateTriggers returns triggered array', async () => {
    mockEvaluateTriggers.mockResolvedValue({
      triggered: ['t1', 't2'],
      pending: [],
      executed: [],
    });

    runPostChatProcessing('user-1', 'Hello', 'Hi');
    await flushPromises();

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('2 triggers evaluated'),
    );
  });

  it('logs executed count when evaluateTriggers returns executed array', async () => {
    mockEvaluateTriggers.mockResolvedValue({
      triggered: ['t1'],
      pending: [],
      executed: ['t1'],
    });

    runPostChatProcessing('user-1', 'Hello', 'Hi');
    await flushPromises();

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('1 triggers executed'),
    );
  });

  it('logs pending count when evaluateTriggers returns pending array', async () => {
    mockEvaluateTriggers.mockResolvedValue({
      triggered: [],
      pending: ['t1'],
      executed: [],
    });

    runPostChatProcessing('user-1', 'Hello', 'Hi');
    await flushPromises();

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('1 triggers pending'),
    );
  });

  it('does not log trigger info when evaluateTriggers returns undefined', async () => {
    mockEvaluateTriggers.mockResolvedValue(undefined);

    runPostChatProcessing('user-1', 'Hello', 'Hi');
    await flushPromises();

    const infoCalls = (mockLog.info.mock.calls as Array<[string]>).filter(
      ([msg]) => msg.includes('trigger'),
    );
    expect(infoCalls).toHaveLength(0);
  });
});
