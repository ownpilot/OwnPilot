/**
 * Comprehensive tests for packages/gateway/src/scheduler/index.ts
 *
 * Covers:
 * - initializeScheduler (singleton creation, configuration, delegation)
 * - getScheduler / getNotificationBridge (before and after init)
 * - stopScheduler (with and without active instance)
 * - executeScheduledTask (prompt, tool, workflow, unknown type, exceptions)
 * - handleSchedulerNotification (channel resolution, send, error paths)
 *
 * Strategy: vi.resetModules() + dynamic re-import before every test so that
 * module-level singletons (schedulerInstance, notificationBridge) are truly
 * reset between tests. The hoisted mock objects are re-established each time
 * in beforeEach.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Shared mock state — allocated once, reset in beforeEach
// ============================================================================

const mockScheduler = {
  setTaskExecutor: vi.fn(),
  setNotificationBridge: vi.fn(),
  initialize: vi.fn().mockResolvedValue(undefined),
  start: vi.fn(),
  stop: vi.fn(),
};

// The notification handler captured when createSchedulerNotificationBridge is called
let capturedNotificationHandler: ((...args: unknown[]) => Promise<void>) | null = null;

const mockChannelService = {
  getChannel: vi.fn(),
  listChannels: vi.fn(() => [] as unknown[]),
  send: vi.fn().mockResolvedValue(undefined),
};

const mockAgent = {
  chat: vi.fn(),
  getTools: vi.fn(() => [] as unknown[]),
};

// ============================================================================
// vi.mock declarations
// ============================================================================

vi.mock('../config/defaults.js', () => ({
  SCHEDULER_CHECK_INTERVAL_MS: 60000,
  SCHEDULER_DEFAULT_TIMEOUT_MS: 300000,
  SCHEDULER_MAX_HISTORY_PER_TASK: 100,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createScheduler: vi.fn(() => mockScheduler),
    createSchedulerNotificationBridge: vi.fn((handler: unknown) => {
      capturedNotificationHandler = handler as (...args: unknown[]) => Promise<void>;
      return { handler };
    }),
    getChannelService: vi.fn(() => mockChannelService),
  };
});

vi.mock('../routes/agents.js', () => ({
  getOrCreateDefaultAgent: vi.fn(() => Promise.resolve(mockAgent)),
}));

vi.mock('../paths/index.js', () => ({
  getDataPaths: vi.fn(() => ({ data: '/tmp/data' })),
}));

vi.mock('../routes/helpers.js', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

// ============================================================================
// Re-import helper: resets module singletons between tests
// ============================================================================

type SchedulerModule = typeof import('./index.js');

async function freshModule(): Promise<SchedulerModule> {
  vi.resetModules();
  return import('./index.js');
}

// ============================================================================
// Task / notification helpers
// ============================================================================

function makeTask(
  overrides: {
    id?: string;
    name?: string;
    type?: string;
    payload?: Record<string, unknown>;
    notifyChannels?: string[];
  } = {}
) {
  return {
    id: overrides.id ?? 'task-001',
    name: overrides.name ?? 'Test Task',
    cron: '* * * * *',
    type: overrides.type ?? 'prompt',
    payload: overrides.payload ?? { type: 'prompt', prompt: 'Say hello' },
    enabled: true,
    priority: 'normal' as const,
    userId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notifyChannels: overrides.notifyChannels,
  };
}

function makeNotificationRequest(channels: string[] = ['telegram']) {
  return {
    userId: 'user-1',
    channels,
    content: {
      title: 'Task Done',
      body: 'Your task finished.',
    },
    priority: 'normal' as const,
  };
}

function makeNotificationEvent(taskOverrides: Parameters<typeof makeTask>[0] = {}) {
  return {
    type: 'complete' as const,
    task: makeTask(taskOverrides),
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Reset all mock state before each test
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  capturedNotificationHandler = null;

  // Restore default implementations
  mockScheduler.initialize.mockResolvedValue(undefined);
  mockScheduler.start.mockReturnValue(undefined);
  mockScheduler.stop.mockReturnValue(undefined);
  mockScheduler.setTaskExecutor.mockReturnValue(undefined);
  mockScheduler.setNotificationBridge.mockReturnValue(undefined);

  mockChannelService.getChannel.mockReturnValue(undefined);
  mockChannelService.listChannels.mockReturnValue([]);
  mockChannelService.send.mockResolvedValue(undefined);

  mockAgent.chat.mockReset();
  mockAgent.getTools.mockReturnValue([]);
});

// ============================================================================
// Helper: initialize a fresh module and return captured private functions
// ============================================================================

async function initFresh() {
  const mod = await freshModule();
  await mod.initializeScheduler();

  // Capture the task executor registered with the scheduler
  const executor = mockScheduler.setTaskExecutor.mock.calls[0]?.[0] as
    | ((task: ReturnType<typeof makeTask>) => Promise<{
        taskId: string;
        status: string;
        startedAt: string;
        completedAt: string;
        result?: unknown;
        error?: string;
        modelUsed?: string;
        tokenUsage?: { input: number; output: number; total: number };
      }>)
    | undefined;

  // Capture the notification handler registered with the bridge
  const notificationHandler = capturedNotificationHandler as
    | ((
        event: ReturnType<typeof makeNotificationEvent>,
        notification: ReturnType<typeof makeNotificationRequest>
      ) => Promise<void>)
    | null;

  return { mod, executor: executor!, notificationHandler: notificationHandler! };
}

// ============================================================================
// Tests: initializeScheduler
// ============================================================================

describe('scheduler/index', () => {
  describe('initializeScheduler', () => {
    it('creates a scheduler via createScheduler', async () => {
      const { mod } = await initFresh();
      const { createScheduler } = await import('@ownpilot/core');
      expect(createScheduler).toHaveBeenCalledOnce();
      mod.stopScheduler();
    });

    it('passes checkInterval from defaults to createScheduler', async () => {
      const { mod } = await initFresh();
      const { createScheduler } = await import('@ownpilot/core');
      const config = (createScheduler as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(config.checkInterval).toBe(60000);
      mod.stopScheduler();
    });

    it('passes defaultTimeout from defaults to createScheduler', async () => {
      const { mod } = await initFresh();
      const { createScheduler } = await import('@ownpilot/core');
      const config = (createScheduler as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(config.defaultTimeout).toBe(300000);
      mod.stopScheduler();
    });

    it('passes maxHistoryPerTask from defaults to createScheduler', async () => {
      const { mod } = await initFresh();
      const { createScheduler } = await import('@ownpilot/core');
      const config = (createScheduler as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(config.maxHistoryPerTask).toBe(100);
      mod.stopScheduler();
    });

    it('builds tasksFilePath containing scheduler/tasks.json', async () => {
      const { mod } = await initFresh();
      const { createScheduler } = await import('@ownpilot/core');
      const config = (createScheduler as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(String(config.tasksFilePath)).toMatch(/scheduler/);
      expect(String(config.tasksFilePath)).toMatch(/tasks\.json/);
      mod.stopScheduler();
    });

    it('builds historyFilePath containing scheduler/history.json', async () => {
      const { mod } = await initFresh();
      const { createScheduler } = await import('@ownpilot/core');
      const config = (createScheduler as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(String(config.historyFilePath)).toMatch(/scheduler/);
      expect(String(config.historyFilePath)).toMatch(/history\.json/);
      mod.stopScheduler();
    });

    it('calls setTaskExecutor with a function', async () => {
      const { mod } = await initFresh();
      expect(mockScheduler.setTaskExecutor).toHaveBeenCalledOnce();
      expect(typeof mockScheduler.setTaskExecutor.mock.calls[0]![0]).toBe('function');
      mod.stopScheduler();
    });

    it('creates notification bridge via createSchedulerNotificationBridge with a function', async () => {
      const { mod } = await initFresh();
      const { createSchedulerNotificationBridge } = await import('@ownpilot/core');
      expect(createSchedulerNotificationBridge).toHaveBeenCalledOnce();
      expect(
        typeof (createSchedulerNotificationBridge as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      ).toBe('function');
      mod.stopScheduler();
    });

    it('calls setNotificationBridge with the created bridge', async () => {
      const { mod } = await initFresh();
      expect(mockScheduler.setNotificationBridge).toHaveBeenCalledOnce();
      const bridge = mockScheduler.setNotificationBridge.mock.calls[0]![0] as { handler: unknown };
      expect(typeof bridge.handler).toBe('function');
      mod.stopScheduler();
    });

    it('calls scheduler.initialize()', async () => {
      const { mod } = await initFresh();
      expect(mockScheduler.initialize).toHaveBeenCalledOnce();
      mod.stopScheduler();
    });

    it('calls scheduler.start()', async () => {
      const { mod } = await initFresh();
      expect(mockScheduler.start).toHaveBeenCalledOnce();
      mod.stopScheduler();
    });

    it('returns the scheduler instance', async () => {
      const mod = await freshModule();
      const result = await mod.initializeScheduler();
      expect(result).toBe(mockScheduler);
      mod.stopScheduler();
    });

    it('returns the same instance on a second call (singleton guard)', async () => {
      const mod = await freshModule();
      const first = await mod.initializeScheduler();
      const second = await mod.initializeScheduler();
      expect(first).toBe(second);
      expect(mockScheduler.initialize).toHaveBeenCalledTimes(1);
      mod.stopScheduler();
    });

    it('does not re-create scheduler on repeated calls', async () => {
      const mod = await freshModule();
      const { createScheduler } = await import('@ownpilot/core');
      await mod.initializeScheduler();
      await mod.initializeScheduler();
      await mod.initializeScheduler();
      expect(createScheduler).toHaveBeenCalledTimes(1);
      mod.stopScheduler();
    });

    it('does not call start() more than once on repeated calls', async () => {
      const mod = await freshModule();
      await mod.initializeScheduler();
      await mod.initializeScheduler();
      expect(mockScheduler.start).toHaveBeenCalledTimes(1);
      mod.stopScheduler();
    });

    it('propagates error when scheduler.initialize() rejects', async () => {
      mockScheduler.initialize.mockRejectedValueOnce(new Error('Init failed'));
      const mod = await freshModule();
      await expect(mod.initializeScheduler()).rejects.toThrow('Init failed');
    });
  });

  // ==========================================================================
  // getScheduler
  // ==========================================================================

  describe('getScheduler', () => {
    it('returns null before initializeScheduler is called', async () => {
      const mod = await freshModule();
      expect(mod.getScheduler()).toBeNull();
    });

    it('returns the scheduler instance after initialization', async () => {
      const mod = await freshModule();
      await mod.initializeScheduler();
      expect(mod.getScheduler()).toBe(mockScheduler);
      mod.stopScheduler();
    });

    it('returns the same reference on repeated calls', async () => {
      const mod = await freshModule();
      await mod.initializeScheduler();
      expect(mod.getScheduler()).toBe(mod.getScheduler());
      mod.stopScheduler();
    });
  });

  // ==========================================================================
  // getNotificationBridge
  // ==========================================================================

  describe('getNotificationBridge', () => {
    it('returns null before initializeScheduler is called', async () => {
      const mod = await freshModule();
      expect(mod.getNotificationBridge()).toBeNull();
    });

    it('returns the notification bridge after initialization', async () => {
      const mod = await freshModule();
      await mod.initializeScheduler();
      const bridge = mod.getNotificationBridge();
      expect(bridge).not.toBeNull();
      expect(typeof (bridge as { handler: unknown }).handler).toBe('function');
      mod.stopScheduler();
    });

    it('returns the same bridge instance on repeated calls', async () => {
      const mod = await freshModule();
      await mod.initializeScheduler();
      expect(mod.getNotificationBridge()).toBe(mod.getNotificationBridge());
      mod.stopScheduler();
    });
  });

  // ==========================================================================
  // stopScheduler
  // ==========================================================================

  describe('stopScheduler', () => {
    it('calls scheduler.stop() when an instance exists', async () => {
      const mod = await freshModule();
      await mod.initializeScheduler();
      mod.stopScheduler();
      expect(mockScheduler.stop).toHaveBeenCalledOnce();
    });

    it('does not throw when called before initialization', async () => {
      const mod = await freshModule();
      expect(() => mod.stopScheduler()).not.toThrow();
    });

    it('does not call stop() when called before initialization', async () => {
      const mod = await freshModule();
      mod.stopScheduler();
      expect(mockScheduler.stop).not.toHaveBeenCalled();
    });

    it('can be called multiple times without throwing after init', async () => {
      const mod = await freshModule();
      await mod.initializeScheduler();
      expect(() => {
        mod.stopScheduler();
        mod.stopScheduler();
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // executeScheduledTask — captured via setTaskExecutor
  // ==========================================================================

  describe('executeScheduledTask', () => {
    // -------------------------------------------------------------------------
    // prompt task — success
    // -------------------------------------------------------------------------

    describe('prompt task — success path', () => {
      it('calls getOrCreateDefaultAgent', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'Hello!', model: 'gpt-4', usage: null },
        });

        await executor(makeTask({ type: 'prompt', payload: { type: 'prompt', prompt: 'Say hi' } }));

        const { getOrCreateDefaultAgent } = await import('../routes/agents.js');
        expect(getOrCreateDefaultAgent).toHaveBeenCalled();
      });

      it('calls agent.chat with the prompt string', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'Hello!', model: 'gpt-4', usage: null },
        });

        await executor(
          makeTask({ type: 'prompt', payload: { type: 'prompt', prompt: 'Summarize today' } })
        );

        expect(mockAgent.chat).toHaveBeenCalledWith('Summarize today');
      });

      it('returns status "completed" when chat ok=true', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'Done!', model: 'gpt-4o', usage: null },
        });

        const result = await executor(
          makeTask({ id: 'p1', type: 'prompt', payload: { type: 'prompt', prompt: 'Go' } })
        );

        expect(result.status).toBe('completed');
      });

      it('returns result.result equal to chat value content', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'Answer text', model: 'm', usage: null },
        });

        const result = await executor(makeTask());

        expect(result.result).toBe('Answer text');
      });

      it('returns result.modelUsed equal to chat value model', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'x', model: 'claude-3-sonnet', usage: null },
        });

        const result = await executor(makeTask());

        expect(result.modelUsed).toBe('claude-3-sonnet');
      });

      it('returns correct taskId in the result', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'x', model: 'm', usage: null },
        });

        const result = await executor(makeTask({ id: 'my-task-id' }));

        expect(result.taskId).toBe('my-task-id');
      });

      it('maps tokenUsage when usage is present', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: {
            content: 'ans',
            model: 'claude',
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          },
        });

        const result = await executor(makeTask());

        expect(result.tokenUsage).toEqual({ input: 100, output: 50, total: 150 });
      });

      it('sets tokenUsage to undefined when usage is null', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'ans', model: 'claude', usage: null },
        });

        const result = await executor(makeTask());

        expect(result.tokenUsage).toBeUndefined();
      });

      it('sets tokenUsage to undefined when usage is missing', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'ans', model: 'claude' },
        });

        const result = await executor(makeTask());

        expect(result.tokenUsage).toBeUndefined();
      });

      it('includes ISO string startedAt in the result', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'x', model: 'm', usage: null },
        });

        const result = await executor(makeTask());

        expect(() => new Date(result.startedAt)).not.toThrow();
        expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });

      it('includes ISO string completedAt in the result', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'x', model: 'm', usage: null },
        });

        const result = await executor(makeTask());

        expect(() => new Date(result.completedAt)).not.toThrow();
        expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
    });

    // -------------------------------------------------------------------------
    // prompt task — failure paths
    // -------------------------------------------------------------------------

    describe('prompt task — failure paths', () => {
      it('returns status "failed" when chat ok=false', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: false,
          error: { message: 'Rate limit exceeded' },
        });

        const result = await executor(makeTask({ id: 'pf1' }));

        expect(result.status).toBe('failed');
      });

      it('returns error message from chat error when ok=false', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: false,
          error: { message: 'Rate limit exceeded' },
        });

        const result = await executor(makeTask());

        expect(result.error).toBe('Rate limit exceeded');
      });

      it('returns status "failed" when agent.chat throws an Error', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockRejectedValue(new Error('Network error'));

        const result = await executor(makeTask({ id: 'ex1' }));

        expect(result.status).toBe('failed');
      });

      it('returns the error message when agent.chat throws', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockRejectedValue(new Error('Network error'));

        const result = await executor(makeTask({ id: 'ex1' }));

        expect(result.error).toBe('Network error');
      });

      it('returns status "failed" when getOrCreateDefaultAgent throws', async () => {
        const { executor } = await initFresh();
        const { getOrCreateDefaultAgent } = await import('../routes/agents.js');
        (getOrCreateDefaultAgent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
          new Error('Agent unavailable')
        );

        const result = await executor(makeTask());

        expect(result.status).toBe('failed');
        expect(result.error).toBe('Agent unavailable');
      });

      it('handles non-Error thrown values via getErrorMessage fallback', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockRejectedValue('plain string error');

        const result = await executor(makeTask());

        expect(result.status).toBe('failed');
        expect(result.error).toBe('plain string error');
      });
    });

    // -------------------------------------------------------------------------
    // tool task
    // -------------------------------------------------------------------------

    describe('tool task', () => {
      const toolPayload = {
        type: 'tool',
        toolName: 'send_email',
        args: { to: 'test@example.com', subject: 'Hello' },
      };

      it('calls agent.getTools() to look up the tool', async () => {
        const { executor } = await initFresh();
        mockAgent.getTools.mockReturnValue([{ name: 'send_email' }]);
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'Sent', model: 'm', usage: null },
        });

        await executor(makeTask({ type: 'tool', payload: toolPayload }));

        expect(mockAgent.getTools).toHaveBeenCalled();
      });

      it('returns status "failed" with "Tool not found" when tool is absent', async () => {
        const { executor } = await initFresh();
        mockAgent.getTools.mockReturnValue([{ name: 'other_tool' }]);

        const result = await executor(makeTask({ id: 'tf1', type: 'tool', payload: toolPayload }));

        expect(result.status).toBe('failed');
        expect(result.error).toBe('Tool not found: send_email');
      });

      it('returns the taskId in the "Tool not found" result', async () => {
        const { executor } = await initFresh();
        mockAgent.getTools.mockReturnValue([]);

        const result = await executor(
          makeTask({ id: 'notfound-42', type: 'tool', payload: toolPayload })
        );

        expect(result.taskId).toBe('notfound-42');
      });

      it('returns failed when tool list is empty', async () => {
        const { executor } = await initFresh();
        mockAgent.getTools.mockReturnValue([]);

        const result = await executor(makeTask({ type: 'tool', payload: toolPayload }));

        expect(result.status).toBe('failed');
        expect(result.error).toContain('send_email');
      });

      it('calls agent.chat with instruction containing the tool name', async () => {
        const { executor } = await initFresh();
        mockAgent.getTools.mockReturnValue([{ name: 'send_email' }]);
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'ok', model: 'm', usage: null },
        });

        await executor(makeTask({ type: 'tool', payload: toolPayload }));

        const chatArg = mockAgent.chat.mock.calls[0]![0] as string;
        expect(chatArg).toContain('send_email');
      });

      it('calls agent.chat with instruction containing JSON-serialized args', async () => {
        const { executor } = await initFresh();
        mockAgent.getTools.mockReturnValue([{ name: 'send_email' }]);
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'ok', model: 'm', usage: null },
        });

        await executor(makeTask({ type: 'tool', payload: toolPayload }));

        const chatArg = mockAgent.chat.mock.calls[0]![0] as string;
        expect(chatArg).toContain(JSON.stringify(toolPayload.args));
      });

      it('returns status "completed" when tool found and chat succeeds', async () => {
        const { executor } = await initFresh();
        mockAgent.getTools.mockReturnValue([{ name: 'send_email' }]);
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'Email sent', model: 'm', usage: null },
        });

        const result = await executor(makeTask({ id: 'ts1', type: 'tool', payload: toolPayload }));

        expect(result.status).toBe('completed');
        expect(result.taskId).toBe('ts1');
        expect(result.result).toBe('Email sent');
      });

      it('returns status "failed" when tool found but chat fails', async () => {
        const { executor } = await initFresh();
        mockAgent.getTools.mockReturnValue([{ name: 'send_email' }]);
        mockAgent.chat.mockResolvedValue({
          ok: false,
          error: { message: 'SMTP error' },
        });

        const result = await executor(makeTask({ type: 'tool', payload: toolPayload }));

        expect(result.status).toBe('failed');
        expect(result.error).toBe('SMTP error');
      });

      it('does not set modelUsed in tool task result', async () => {
        const { executor } = await initFresh();
        mockAgent.getTools.mockReturnValue([{ name: 'send_email' }]);
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'ok', model: 'm', usage: null },
        });

        const result = await executor(makeTask({ type: 'tool', payload: toolPayload }));

        expect(result.modelUsed).toBeUndefined();
      });

      it('returns failed when getTools throws synchronously', async () => {
        const { executor } = await initFresh();
        mockAgent.getTools.mockImplementation(() => {
          throw new Error('Registry failure');
        });

        const result = await executor(makeTask({ type: 'tool', payload: toolPayload }));

        expect(result.status).toBe('failed');
        expect(result.error).toBe('Registry failure');
      });
    });

    // -------------------------------------------------------------------------
    // workflow task
    // -------------------------------------------------------------------------

    describe('workflow task', () => {
      it('returns "completed" when all steps succeed', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'step result', model: 'm', usage: null },
        });

        const payload = {
          type: 'workflow',
          steps: [
            { name: 'Step A', type: 'prompt', payload: { type: 'prompt', prompt: 'Do A' } },
            { name: 'Step B', type: 'prompt', payload: { type: 'prompt', prompt: 'Do B' } },
          ],
        };

        const result = await executor(makeTask({ id: 'wf1', type: 'workflow', payload }));

        expect(result.status).toBe('completed');
        expect(result.taskId).toBe('wf1');
      });

      it('collects results from all successful steps', async () => {
        const { executor } = await initFresh();
        mockAgent.chat
          .mockResolvedValueOnce({
            ok: true,
            value: { content: 'A done', model: 'm', usage: null },
          })
          .mockResolvedValueOnce({
            ok: true,
            value: { content: 'B done', model: 'm', usage: null },
          });

        const payload = {
          type: 'workflow',
          steps: [
            { name: 'Step A', type: 'prompt', payload: { type: 'prompt', prompt: 'A' } },
            { name: 'Step B', type: 'prompt', payload: { type: 'prompt', prompt: 'B' } },
          ],
        };

        const result = await executor(makeTask({ type: 'workflow', payload }));

        expect(Array.isArray(result.result)).toBe(true);
        expect((result.result as unknown[]).length).toBe(2);
      });

      it('stops execution at the first failed step', async () => {
        const { executor } = await initFresh();
        mockAgent.chat
          .mockResolvedValueOnce({ ok: false, error: { message: 'Step A bombed' } })
          .mockResolvedValueOnce({ ok: true, value: { content: 'B', model: 'm', usage: null } });

        const payload = {
          type: 'workflow',
          steps: [
            { name: 'Alpha', type: 'prompt', payload: { type: 'prompt', prompt: 'A' } },
            { name: 'Beta', type: 'prompt', payload: { type: 'prompt', prompt: 'B' } },
          ],
        };

        const result = await executor(makeTask({ type: 'workflow', payload }));

        expect(result.status).toBe('failed');
        // Step B should not have been invoked
        expect(mockAgent.chat).toHaveBeenCalledTimes(1);
      });

      it('includes the failing step name in the error message', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({ ok: false, error: { message: 'oops' } });

        const payload = {
          type: 'workflow',
          steps: [
            { name: 'CriticalStep', type: 'prompt', payload: { type: 'prompt', prompt: 'X' } },
          ],
        };

        const result = await executor(makeTask({ type: 'workflow', payload }));

        expect(result.error).toContain('CriticalStep');
      });

      it('includes partial results up to the failure point', async () => {
        const { executor } = await initFresh();
        mockAgent.chat
          .mockResolvedValueOnce({
            ok: true,
            value: { content: 'first ok', model: 'm', usage: null },
          })
          .mockResolvedValueOnce({ ok: false, error: { message: 'second failed' } });

        const payload = {
          type: 'workflow',
          steps: [
            { name: 'One', type: 'prompt', payload: { type: 'prompt', prompt: '1' } },
            { name: 'Two', type: 'prompt', payload: { type: 'prompt', prompt: '2' } },
          ],
        };

        const result = await executor(makeTask({ type: 'workflow', payload }));

        expect(result.status).toBe('failed');
        expect(Array.isArray(result.result)).toBe(true);
        expect((result.result as unknown[]).length).toBeGreaterThanOrEqual(1);
      });

      it('handles a workflow with a single step successfully', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'solo', model: 'm', usage: null },
        });

        const payload = {
          type: 'workflow',
          steps: [{ name: 'Solo', type: 'prompt', payload: { type: 'prompt', prompt: 'alone' } }],
        };

        const result = await executor(makeTask({ type: 'workflow', payload }));

        expect(result.status).toBe('completed');
      });

      it('handles an empty steps array and returns completed with empty results array', async () => {
        const { executor } = await initFresh();

        const payload = { type: 'workflow', steps: [] };

        const result = await executor(makeTask({ type: 'workflow', payload }));

        expect(result.status).toBe('completed');
        expect(result.result).toEqual([]);
      });

      it('includes taskId in the workflow completed result', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({
          ok: true,
          value: { content: 'ok', model: 'm', usage: null },
        });

        const payload = {
          type: 'workflow',
          steps: [{ name: 'S', type: 'prompt', payload: { type: 'prompt', prompt: 'p' } }],
        };

        const result = await executor(makeTask({ id: 'wf-id-99', type: 'workflow', payload }));

        expect(result.taskId).toBe('wf-id-99');
      });

      it('includes taskId in the workflow failed result', async () => {
        const { executor } = await initFresh();
        mockAgent.chat.mockResolvedValue({ ok: false, error: { message: 'fail' } });

        const payload = {
          type: 'workflow',
          steps: [{ name: 'F', type: 'prompt', payload: { type: 'prompt', prompt: 'p' } }],
        };

        const result = await executor(makeTask({ id: 'wf-fail-id', type: 'workflow', payload }));

        expect(result.taskId).toBe('wf-fail-id');
      });
    });

    // -------------------------------------------------------------------------
    // Unknown task type
    // -------------------------------------------------------------------------

    describe('unknown task type', () => {
      it('returns status "failed" for an unknown type', async () => {
        const { executor } = await initFresh();

        const result = await executor(makeTask({ type: 'unknown', payload: { type: 'unknown' } }));

        expect(result.status).toBe('failed');
      });

      it('includes the unknown type name in the error message', async () => {
        const { executor } = await initFresh();

        const result = await executor(makeTask({ type: 'magic', payload: { type: 'magic' } }));

        expect(result.error).toContain('magic');
      });

      it('sets taskId correctly for unknown type result', async () => {
        const { executor } = await initFresh();

        const result = await executor(
          makeTask({ id: 'unk-1', type: 'whatever', payload: { type: 'whatever' } })
        );

        expect(result.taskId).toBe('unk-1');
      });

      it('includes startedAt and completedAt even for unknown type', async () => {
        const { executor } = await initFresh();

        const result = await executor(makeTask({ type: 'bad', payload: { type: 'bad' } }));

        expect(result.startedAt).toBeTruthy();
        expect(result.completedAt).toBeTruthy();
      });

      it('returns error message matching "Unknown task type: <type>"', async () => {
        const { executor } = await initFresh();

        const result = await executor(makeTask({ type: 'foobar', payload: { type: 'foobar' } }));

        expect(result.error).toMatch(/Unknown task type: foobar/);
      });
    });
  });

  // ==========================================================================
  // handleSchedulerNotification — captured via createSchedulerNotificationBridge
  // ==========================================================================

  describe('handleSchedulerNotification', () => {
    it('does not call service.send when channels array is empty', async () => {
      const { notificationHandler } = await initFresh();

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: [] }),
        makeNotificationRequest([])
      );

      expect(mockChannelService.send).not.toHaveBeenCalled();
    });

    it('does not call getChannelService when channels array is empty', async () => {
      const { notificationHandler } = await initFresh();
      const { getChannelService } = await import('@ownpilot/core');

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: [] }),
        makeNotificationRequest([])
      );

      expect(getChannelService).not.toHaveBeenCalled();
    });

    it('returns early when notification.channels is empty and task has no notifyChannels', async () => {
      const { notificationHandler } = await initFresh();

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: undefined }),
        makeNotificationRequest([])
      );

      expect(mockChannelService.send).not.toHaveBeenCalled();
    });

    it('prefers task.notifyChannels over notification.channels', async () => {
      const { notificationHandler } = await initFresh();
      const mockDirect = { getPlatform: vi.fn(() => 'telegram') };
      mockChannelService.getChannel.mockReturnValue(mockDirect);

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: ['task-chan'] }),
        makeNotificationRequest(['notif-chan'])
      );

      expect(mockChannelService.getChannel).toHaveBeenCalledWith('task-chan');
      expect(mockChannelService.getChannel).not.toHaveBeenCalledWith('notif-chan');
    });

    it('uses notification.channels when task.notifyChannels is undefined', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockReturnValue({ getPlatform: vi.fn(() => 'telegram') });

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: undefined }),
        makeNotificationRequest(['fallback-chan'])
      );

      expect(mockChannelService.getChannel).toHaveBeenCalledWith('fallback-chan');
    });

    it('calls service.send when a direct channel is found by channelId', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockReturnValue({ getPlatform: vi.fn(() => 'telegram') });

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: ['plugin-xyz'] }),
        makeNotificationRequest(['plugin-xyz'])
      );

      expect(mockChannelService.send).toHaveBeenCalledOnce();
      expect(mockChannelService.send.mock.calls[0]![0]).toBe('plugin-xyz');
    });

    it('sends formatted title+body message to the channel', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockReturnValue({ getPlatform: vi.fn(() => 'telegram') });

      const notification = {
        ...makeNotificationRequest(['plugin-abc']),
        content: { title: 'My Title', body: 'My Body' },
      };

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: ['plugin-abc'] }),
        notification
      );

      const payload = mockChannelService.send.mock.calls[0]![1] as { text: string };
      expect(payload.text).toContain('My Title');
      expect(payload.text).toContain('My Body');
    });

    it('sets platformChatId to the targetPluginId in the send payload', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockReturnValue({ getPlatform: vi.fn(() => 'telegram') });

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: ['my-plugin-id'] }),
        makeNotificationRequest(['my-plugin-id'])
      );

      const payload = mockChannelService.send.mock.calls[0]![1] as { platformChatId: string };
      expect(payload.platformChatId).toBe('my-plugin-id');
    });

    it('searches listChannels by platform when direct getChannel returns undefined', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockReturnValue(undefined);
      mockChannelService.listChannels.mockReturnValue([
        { platform: 'telegram', pluginId: 'tg-plugin-1', status: 'connected' },
        { platform: 'telegram', pluginId: 'tg-plugin-2', status: 'disconnected' },
      ]);

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: ['telegram'] }),
        makeNotificationRequest(['telegram'])
      );

      expect(mockChannelService.listChannels).toHaveBeenCalled();
      expect(mockChannelService.send).toHaveBeenCalledOnce();
      expect(mockChannelService.send.mock.calls[0]![0]).toBe('tg-plugin-1');
    });

    it('uses the first connected channel when searching by platform', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockReturnValue(undefined);
      mockChannelService.listChannels.mockReturnValue([
        { platform: 'slack', pluginId: 'slack-disconnected', status: 'disconnected' },
        { platform: 'slack', pluginId: 'slack-connected', status: 'connected' },
      ]);

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: ['slack'] }),
        makeNotificationRequest(['slack'])
      );

      expect(mockChannelService.send).toHaveBeenCalledWith(
        'slack-connected',
        expect.objectContaining({ text: expect.any(String) })
      );
    });

    it('does not send when channel not found directly and no matching platform channel', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockReturnValue(undefined);
      mockChannelService.listChannels.mockReturnValue([]);

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: ['nonexistent'] }),
        makeNotificationRequest(['nonexistent'])
      );

      expect(mockChannelService.send).not.toHaveBeenCalled();
    });

    it('does not send when platform matches exist but none are connected', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockReturnValue(undefined);
      mockChannelService.listChannels.mockReturnValue([
        { platform: 'telegram', pluginId: 'tg-1', status: 'disconnected' },
        { platform: 'telegram', pluginId: 'tg-2', status: 'error' },
      ]);

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: ['telegram'] }),
        makeNotificationRequest(['telegram'])
      );

      expect(mockChannelService.send).not.toHaveBeenCalled();
    });

    it('continues processing remaining channels when one send fails', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel
        .mockReturnValueOnce({ getPlatform: vi.fn(() => 'telegram') })
        .mockReturnValueOnce({ getPlatform: vi.fn(() => 'slack') });
      mockChannelService.send
        .mockRejectedValueOnce(new Error('Telegram down'))
        .mockResolvedValueOnce(undefined);

      await expect(
        notificationHandler(
          makeNotificationEvent({ notifyChannels: ['chan-a', 'chan-b'] }),
          makeNotificationRequest(['chan-a', 'chan-b'])
        )
      ).resolves.not.toThrow();

      expect(mockChannelService.send).toHaveBeenCalledTimes(2);
    });

    it('does not throw when send fails', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockReturnValue({ getPlatform: vi.fn(() => 'telegram') });
      mockChannelService.send.mockRejectedValue(new Error('Network failure'));

      await expect(
        notificationHandler(
          makeNotificationEvent({ notifyChannels: ['ch-1'] }),
          makeNotificationRequest(['ch-1'])
        )
      ).resolves.toBeUndefined();
    });

    it('sends to multiple channels when all are found directly', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockImplementation((id: string) => ({
        getPlatform: () => (id === 'ch-a' ? 'telegram' : 'slack'),
      }));

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: ['ch-a', 'ch-b'] }),
        makeNotificationRequest(['ch-a', 'ch-b'])
      );

      expect(mockChannelService.send).toHaveBeenCalledTimes(2);
    });

    it('calls getChannelService exactly once (before the loop, shared across channels)', async () => {
      const { notificationHandler } = await initFresh();
      const { getChannelService } = await import('@ownpilot/core');
      mockChannelService.getChannel.mockReturnValue({ getPlatform: vi.fn(() => 'telegram') });

      await notificationHandler(
        makeNotificationEvent({ notifyChannels: ['a', 'b', 'c'] }),
        makeNotificationRequest(['a', 'b', 'c'])
      );

      // getChannelService() is called once before the for-loop; the same service
      // instance is reused for all channel iterations.
      expect(getChannelService).toHaveBeenCalledTimes(1);
    });

    it('formats the message as title newline newline body', async () => {
      const { notificationHandler } = await initFresh();
      mockChannelService.getChannel.mockReturnValue({ getPlatform: vi.fn(() => 'telegram') });

      const notification = {
        ...makeNotificationRequest(['ch']),
        content: { title: 'TITLE', body: 'BODY' },
      };

      await notificationHandler(makeNotificationEvent({ notifyChannels: ['ch'] }), notification);

      const payload = mockChannelService.send.mock.calls[0]![1] as { text: string };
      expect(payload.text).toBe('TITLE\n\nBODY');
    });
  });
});
