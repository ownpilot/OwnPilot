import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be initialised before vi.mock() factories run
// ---------------------------------------------------------------------------

const {
  captured,
  MockHeartbeatRunner,
  MockAgentCommunicationBus,
  MockBudgetTracker,
  mockRunHeartbeat,
  mockDispose,
  mockEmit,
  mockGetEventSystem,
  mockCreateMemory,
  mockMemoryService,
  mockGetServiceRegistry,
  mockMsgRepo,
  mockAdapter,
  mockChat,
  mockGetOrCreateChatAgent,
  mockResolveForProcess,
  mockSendTelegramMessage,
} = vi.hoisted(() => {
  /** Mutable container shared between mock factory and test assertions. */
  const captured: {
    engine: Record<string, unknown>;
    eventBus: { emit: (e: string, p: unknown) => void };
  } = { engine: {} as Record<string, unknown>, eventBus: { emit: () => void 0 } };

  const mockRunHeartbeat = vi.fn();
  const mockDispose = vi.fn();

  const MockHeartbeatRunner = vi.fn().mockImplementation(function (
    this: unknown,
    agentEngine: unknown,
    _sr: unknown,
    _cb: unknown,
    _hl: unknown,
    _bt: unknown,
    eventBus: unknown
  ) {
    captured.engine = agentEngine as Record<string, unknown>;
    captured.eventBus = eventBus as { emit: (e: string, p: unknown) => void };
    return { runHeartbeat: mockRunHeartbeat };
  });

  const MockAgentCommunicationBus = vi.fn().mockImplementation(function () {
    return { dispose: mockDispose };
  });
  const MockBudgetTracker = vi.fn().mockImplementation(function () {
    return {};
  });

  const mockEmit = vi.fn();
  const mockGetEventSystem = vi.fn().mockReturnValue({ emit: mockEmit });

  const mockCreateMemory = vi.fn().mockResolvedValue(undefined);
  const mockMemoryService = { createMemory: mockCreateMemory };
  const mockGetServiceRegistry = vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue(mockMemoryService),
  });

  const mockMsgRepo = {
    create: vi.fn(),
    findForAgent: vi.fn(),
    findByThread: vi.fn(),
    markAsRead: vi.fn(),
  };
  const mockAdapter = { query: vi.fn(), queryOne: vi.fn(), execute: vi.fn() };

  const mockChat = vi.fn();
  const mockGetOrCreateChatAgent = vi.fn().mockResolvedValue({ chat: mockChat });
  const mockResolveForProcess = vi.fn().mockResolvedValue({
    provider: 'anthropic',
    model: 'claude-test',
  });
  const mockSendTelegramMessage = vi.fn();

  return {
    captured,
    MockHeartbeatRunner,
    MockAgentCommunicationBus,
    MockBudgetTracker,
    mockRunHeartbeat,
    mockDispose,
    mockEmit,
    mockGetEventSystem,
    mockCreateMemory,
    mockMemoryService,
    mockGetServiceRegistry,
    mockMsgRepo,
    mockAdapter,
    mockChat,
    mockGetOrCreateChatAgent,
    mockResolveForProcess,
    mockSendTelegramMessage,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@ownpilot/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HeartbeatRunner: MockHeartbeatRunner,
  AgentCommunicationBus: MockAgentCommunicationBus,
  BudgetTracker: MockBudgetTracker,
  getEventSystem: mockGetEventSystem,
  getServiceRegistry: mockGetServiceRegistry,
  getLog: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../db/adapters/index.js', () => ({
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

vi.mock('../db/repositories/souls.js', () => ({
  getSoulsRepository: vi.fn().mockReturnValue({
    getByAgentId: vi.fn(),
    update: vi.fn(),
    createVersion: vi.fn(),
    setHeartbeatEnabled: vi.fn(),
    updateTaskStatus: vi.fn(),
    updateHeartbeatChecklist: vi.fn(),
  }),
}));

vi.mock('../db/repositories/heartbeat-log.js', () => ({
  getHeartbeatLogRepository: vi.fn().mockReturnValue({
    getRecent: vi.fn(),
    getLatest: vi.fn(),
    create: vi.fn(),
  }),
}));

vi.mock('../db/repositories/agent-messages.js', () => ({
  getAgentMessagesRepository: vi.fn().mockReturnValue(mockMsgRepo),
}));

vi.mock('../routes/agents.js', () => ({
  getOrCreateChatAgent: mockGetOrCreateChatAgent,
}));

vi.mock('./model-routing.js', () => ({
  resolveForProcess: mockResolveForProcess,
}));

vi.mock('../tools/notification-tools.js', () => ({
  sendTelegramMessage: mockSendTelegramMessage,
}));

// ---------------------------------------------------------------------------
// Service under test (static import — mocks are in place before this runs)
// ---------------------------------------------------------------------------

import {
  resetHeartbeatRunner,
  getHeartbeatRunner,
  runAgentHeartbeat,
} from './soul-heartbeat-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Engine = {
  processMessage: (req: {
    message: string;
    context?: { allowedTools?: string[] };
  }) => Promise<unknown>;
  saveMemory: (agentId: string, content: string, source: string) => Promise<void>;
  createNote: (note: { content: string; source: string; category: string }) => Promise<void>;
  sendToChannel: (channel: string, message: string, chatId?: string) => Promise<void>;
};

/** Ensure captured.engine / captured.eventBus are populated. */
function initRunner() {
  getHeartbeatRunner();
}

function getEngine() {
  return captured.engine as unknown as Engine;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Dispose BEFORE clearing so the dispose call is wiped by clearAllMocks
  resetHeartbeatRunner();
  vi.clearAllMocks();

  // Re-apply implementations cleared by clearAllMocks on class constructors
  MockHeartbeatRunner.mockImplementation(function (
    this: unknown,
    agentEngine: unknown,
    _sr: unknown,
    _cb: unknown,
    _hl: unknown,
    _bt: unknown,
    eventBus: unknown
  ) {
    captured.engine = agentEngine as Record<string, unknown>;
    captured.eventBus = eventBus as { emit: (e: string, p: unknown) => void };
    return { runHeartbeat: mockRunHeartbeat };
  });
  MockAgentCommunicationBus.mockImplementation(function () {
    return { dispose: mockDispose };
  });
  MockBudgetTracker.mockImplementation(function () {
    return {};
  });
  mockGetEventSystem.mockReturnValue({ emit: mockEmit });
  mockGetServiceRegistry.mockReturnValue({ get: vi.fn().mockReturnValue(mockMemoryService) });
  mockGetOrCreateChatAgent.mockResolvedValue({ chat: mockChat });
  mockResolveForProcess.mockResolvedValue({ provider: 'anthropic', model: 'claude-test' });
});

// ---------------------------------------------------------------------------
// getHeartbeatRunner()
// ---------------------------------------------------------------------------

describe('getHeartbeatRunner()', () => {
  it('creates a HeartbeatRunner, AgentCommunicationBus, and BudgetTracker', () => {
    getHeartbeatRunner();
    expect(MockHeartbeatRunner).toHaveBeenCalledOnce();
    expect(MockAgentCommunicationBus).toHaveBeenCalledOnce();
    expect(MockBudgetTracker).toHaveBeenCalledOnce();
  });

  it('returns the same instance on subsequent calls (singleton)', () => {
    const r1 = getHeartbeatRunner();
    const r2 = getHeartbeatRunner();
    expect(r1).toBe(r2);
    expect(MockHeartbeatRunner).toHaveBeenCalledOnce();
  });

  it('passes soul-repo, commBus, hbLogRepo, and budgetTracker to HeartbeatRunner', () => {
    getHeartbeatRunner();
    // HeartbeatRunner(agentEngine, soulRepo, commBus, hbLogRepo, budgetTracker, eventBus)
    const [, soulRepo, commBus, hbLogRepo, budgetTracker] = MockHeartbeatRunner.mock
      .calls[0] as unknown[];
    expect(soulRepo).toBeDefined();
    expect(commBus).toBeDefined();
    expect(hbLogRepo).toBeDefined();
    expect(budgetTracker).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// resetHeartbeatRunner()
// ---------------------------------------------------------------------------

describe('resetHeartbeatRunner()', () => {
  it('disposes the communication bus', () => {
    getHeartbeatRunner(); // creates communicationBusInstance
    resetHeartbeatRunner();
    expect(mockDispose).toHaveBeenCalledOnce();
  });

  it('resets singleton so next call creates a fresh runner', () => {
    getHeartbeatRunner();
    resetHeartbeatRunner();
    getHeartbeatRunner();
    expect(MockHeartbeatRunner).toHaveBeenCalledTimes(2);
  });

  it('is safe to call when no runner exists', () => {
    // runner is null from beforeEach
    expect(() => resetHeartbeatRunner()).not.toThrow();
    expect(mockDispose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runAgentHeartbeat()
// ---------------------------------------------------------------------------

describe('runAgentHeartbeat()', () => {
  it('returns { success: true } when runner reports ok', async () => {
    mockRunHeartbeat.mockResolvedValue({
      ok: true,
      value: { tasks: [], totalCost: 0, durationMs: 10 },
    });
    const result = await runAgentHeartbeat('agent-1');
    expect(result).toEqual({ success: true });
  });

  it('returns { success: false, error } when runner returns ok=false', async () => {
    mockRunHeartbeat.mockResolvedValue({
      ok: false,
      error: new Error('budget exceeded'),
    });
    const result = await runAgentHeartbeat('agent-1');
    expect(result).toEqual({ success: false, error: 'budget exceeded' });
  });

  it('returns { success: false, error } when runner throws an Error', async () => {
    mockRunHeartbeat.mockRejectedValue(new Error('unexpected crash'));
    const result = await runAgentHeartbeat('agent-1');
    expect(result).toEqual({ success: false, error: 'unexpected crash' });
  });

  it('returns { success: false, error } when runner throws a non-Error value', async () => {
    mockRunHeartbeat.mockRejectedValue('string error');
    const result = await runAgentHeartbeat('agent-1');
    expect(result).toEqual({ success: false, error: 'string error' });
  });

  it('passes force=true to runner.runHeartbeat', async () => {
    mockRunHeartbeat.mockResolvedValue({
      ok: true,
      value: { tasks: [], totalCost: 0, durationMs: 0 },
    });
    await runAgentHeartbeat('agent-1', true);
    expect(mockRunHeartbeat).toHaveBeenCalledWith('agent-1', true);
  });
});

// ---------------------------------------------------------------------------
// heartbeat engine — saveMemory()
// ---------------------------------------------------------------------------

describe('heartbeat engine — saveMemory()', () => {
  it('calls memorySvc.createMemory with agentId, content, source, type=fact', async () => {
    initRunner();
    await getEngine().saveMemory('agent-1', 'key insight', 'heartbeat');
    expect(mockCreateMemory).toHaveBeenCalledWith('agent-1', {
      content: 'key insight',
      source: 'heartbeat',
      type: 'fact',
    });
  });

  it('does not throw when createMemory rejects', async () => {
    initRunner();
    mockCreateMemory.mockRejectedValueOnce(new Error('DB error'));
    await expect(getEngine().saveMemory('agent-1', 'x', 'heartbeat')).resolves.toBeUndefined();
  });

  it('does not throw when getServiceRegistry throws', async () => {
    initRunner();
    mockGetServiceRegistry.mockImplementationOnce(() => {
      throw new Error('registry down');
    });
    await expect(getEngine().saveMemory('agent-1', 'x', 'heartbeat')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// heartbeat engine — createNote()
// ---------------------------------------------------------------------------

describe('heartbeat engine — createNote()', () => {
  it('calls memorySvc.createMemory with system agentId and category as tag (H4 fix)', async () => {
    initRunner();
    await getEngine().createNote({ content: 'note text', source: 'heartbeat', category: 'trends' });
    expect(mockCreateMemory).toHaveBeenCalledWith('system', {
      content: 'note text',
      source: 'heartbeat',
      type: 'fact',
      tags: ['trends'],
    });
  });

  it('does not throw when createMemory rejects', async () => {
    initRunner();
    mockCreateMemory.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      getEngine().createNote({ content: 'x', source: 'heartbeat', category: 'cat' })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// heartbeat engine — sendToChannel()
// ---------------------------------------------------------------------------

describe('heartbeat engine — sendToChannel()', () => {
  it('calls sendTelegramMessage with provided chatId for telegram (M8 fix)', async () => {
    initRunner();
    await getEngine().sendToChannel('telegram', 'hello!', 'chat-123');
    expect(mockSendTelegramMessage).toHaveBeenCalledWith('chat-123', 'hello!');
  });

  it('falls back to "default" chatId when chatId is undefined (M8 fix)', async () => {
    initRunner();
    await getEngine().sendToChannel('telegram', 'hello!', undefined);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith('default', 'hello!');
  });

  it('does not call sendTelegramMessage for unknown channels', async () => {
    initRunner();
    await getEngine().sendToChannel('slack', 'hello!', 'chat-123');
    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  it('does not throw when sendTelegramMessage rejects', async () => {
    initRunner();
    mockSendTelegramMessage.mockRejectedValueOnce(new Error('network error'));
    await expect(getEngine().sendToChannel('telegram', 'msg', 'chat-1')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// heartbeat engine — processMessage()
// ---------------------------------------------------------------------------

describe('heartbeat engine — processMessage()', () => {
  it('calls agent.chat with the request message and returns content + tokenUsage', async () => {
    initRunner();
    mockChat.mockResolvedValue({
      ok: true,
      value: { content: 'response', usage: { promptTokens: 10, completionTokens: 5 } },
    });
    const result = await getEngine().processMessage({ message: 'run heartbeat' });
    expect(mockChat).toHaveBeenCalledWith('run heartbeat', expect.any(Object));
    expect((result as { content: string }).content).toBe('response');
    expect((result as { tokenUsage: { input: number; output: number } }).tokenUsage).toEqual({
      input: 10,
      output: 5,
    });
  });

  it('passes resolveForProcess result to getOrCreateChatAgent', async () => {
    initRunner();
    mockResolveForProcess.mockResolvedValue({ provider: 'openai', model: 'gpt-4' });
    mockChat.mockResolvedValue({ ok: true, value: { content: 'ok', usage: null } });
    await getEngine().processMessage({ message: 'test' });
    expect(mockGetOrCreateChatAgent).toHaveBeenCalledWith('openai', 'gpt-4', undefined);
  });

  it('onBeforeToolCall approves tools in allowedTools list (H2 fix)', async () => {
    initRunner();
    let capturedFilter:
      | ((tc: { name: string }) => Promise<{ approved: boolean; reason?: string }>)
      | undefined;
    mockChat.mockImplementation(
      (_msg: string, opts: { onBeforeToolCall?: typeof capturedFilter }) => {
        capturedFilter = opts.onBeforeToolCall;
        return Promise.resolve({ ok: true, value: { content: 'ok', usage: null } });
      }
    );

    await getEngine().processMessage({
      message: 'run',
      context: { allowedTools: ['search_web'] },
    });

    expect(capturedFilter).toBeDefined();
    // Exact name and namespace-qualified name both approved
    expect(await capturedFilter!({ name: 'search_web' })).toEqual({ approved: true });
    expect(await capturedFilter!({ name: 'core.search_web' })).toEqual({ approved: true });
    // Tool not in list is blocked
    const blocked = await capturedFilter!({ name: 'core.delete_data' });
    expect(blocked.approved).toBe(false);
    expect(blocked.reason).toContain('core.delete_data');
  });

  it('throws when agent.chat returns ok=false', async () => {
    initRunner();
    mockChat.mockResolvedValue({ ok: false, error: new Error('model error') });
    await expect(getEngine().processMessage({ message: 'fail' })).rejects.toThrow('model error');
  });
});

// ---------------------------------------------------------------------------
// event bus adapter (createEventBusAdapter)
// ---------------------------------------------------------------------------

describe('event bus adapter', () => {
  it('calls getEventSystem().emit with event, source, and payload (H5 fix)', () => {
    initRunner();
    captured.eventBus.emit('soul.heartbeat.started', { agentId: 'a1' });
    expect(mockEmit).toHaveBeenCalledWith('soul.heartbeat.started', 'soul-heartbeat', {
      agentId: 'a1',
    });
  });

  it('does not throw when getEventSystem throws', () => {
    initRunner();
    mockGetEventSystem.mockImplementationOnce(() => {
      throw new Error('event system not ready');
    });
    expect(() => captured.eventBus.emit('test', {})).not.toThrow();
  });

  it('each new runner creation receives a fresh event bus adapter', () => {
    getHeartbeatRunner();
    const bus1 = captured.eventBus;
    resetHeartbeatRunner();
    getHeartbeatRunner();
    const bus2 = captured.eventBus;
    expect(bus1).not.toBe(bus2);
  });
});
