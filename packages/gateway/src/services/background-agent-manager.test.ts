/**
 * Background Agent Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BackgroundAgentConfig, BackgroundAgentCycleResult } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRunCycle = vi.fn<[], Promise<BackgroundAgentCycleResult>>().mockResolvedValue({
  success: true,
  toolCalls: [{ tool: 'test', args: {}, result: 'ok', duration: 50 }],
  outputMessage: 'Done',
  tokensUsed: { prompt: 100, completion: 50 },
  durationMs: 500,
  turns: 1,
});

vi.mock('./background-agent-runner.js', () => ({
  BackgroundAgentRunner: vi.fn().mockImplementation(() => ({
    runCycle: mockRunCycle,
    updateConfig: vi.fn(),
  })),
}));

const mockSaveSession = vi.fn().mockResolvedValue(undefined);
const mockLoadSession = vi.fn().mockResolvedValue(null);
const mockSaveHistory = vi.fn().mockResolvedValue(undefined);
const mockGetInterruptedSessions = vi.fn().mockResolvedValue([]);
const mockGetAutoStartAgents = vi.fn().mockResolvedValue([]);

vi.mock('../db/repositories/background-agents.js', () => ({
  getBackgroundAgentsRepository: () => ({
    saveSession: mockSaveSession,
    loadSession: mockLoadSession,
    saveHistory: mockSaveHistory,
    getInterruptedSessions: mockGetInterruptedSessions,
    getAutoStartAgents: mockGetAutoStartAgents,
  }),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventSystem: () => ({
      emit: vi.fn(),
      emitRaw: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
      onAny: vi.fn().mockReturnValue(() => {}),
      off: vi.fn(),
      scoped: () => ({ on: vi.fn(), emit: vi.fn() }),
    }),
  };
});

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { BackgroundAgentManager } = await import('./background-agent-manager.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<BackgroundAgentConfig> = {}): BackgroundAgentConfig {
  return {
    id: 'bg-1',
    userId: 'user-1',
    name: 'Test Agent',
    mission: 'Monitor goals',
    mode: 'interval',
    allowedTools: [],
    limits: {
      maxTurnsPerCycle: 10,
      maxToolCallsPerCycle: 50,
      maxCyclesPerHour: 60,
      cycleTimeoutMs: 120000,
    },
    intervalMs: 300000,
    autoStart: false,
    createdBy: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackgroundAgentManager', () => {
  let manager: InstanceType<typeof BackgroundAgentManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    manager = new BackgroundAgentManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startAgent', () => {
    it('creates a session and returns it', async () => {
      const config = makeConfig();
      const session = await manager.startAgent(config);

      expect(session.state).toBe('running');
      expect(session.config.id).toBe('bg-1');
      expect(session.cyclesCompleted).toBe(0);
    });

    it('throws if agent is already running', async () => {
      const config = makeConfig();
      await manager.startAgent(config);

      await expect(manager.startAgent(config)).rejects.toThrow('already running');
    });

    it('persists session to DB', async () => {
      await manager.startAgent(makeConfig());
      expect(mockSaveSession).toHaveBeenCalled();
    });
  });

  describe('pauseAgent', () => {
    it('pauses a running agent', async () => {
      await manager.startAgent(makeConfig());

      const result = await manager.pauseAgent('bg-1');
      expect(result).toBe(true);

      const session = manager.getSession('bg-1');
      expect(session?.state).toBe('paused');
    });

    it('returns false if agent is not running', async () => {
      const result = await manager.pauseAgent('bg-999');
      expect(result).toBe(false);
    });
  });

  describe('resumeAgent', () => {
    it('resumes a paused agent', async () => {
      await manager.startAgent(makeConfig());
      await manager.pauseAgent('bg-1');

      const result = await manager.resumeAgent('bg-1');
      expect(result).toBe(true);

      const session = manager.getSession('bg-1');
      expect(session?.state).toBe('running');
    });

    it('returns false if agent is not paused', async () => {
      await manager.startAgent(makeConfig());
      const result = await manager.resumeAgent('bg-1');
      expect(result).toBe(false);
    });
  });

  describe('stopAgent', () => {
    it('stops a running agent', async () => {
      await manager.startAgent(makeConfig());

      const result = await manager.stopAgent('bg-1');
      expect(result).toBe(true);

      const session = manager.getSession('bg-1');
      expect(session).toBeNull();
    });

    it('returns false for unknown agent', async () => {
      const result = await manager.stopAgent('bg-999');
      expect(result).toBe(false);
    });
  });

  describe('getSession / getAllSessions', () => {
    it('returns null for unknown agent', () => {
      expect(manager.getSession('bg-999')).toBeNull();
    });

    it('returns sessions filtered by user', async () => {
      await manager.startAgent(makeConfig({ id: 'bg-1', userId: 'user-1' }));
      await manager.startAgent(makeConfig({ id: 'bg-2', userId: 'user-2' }));

      const user1Sessions = manager.getSessionsByUser('user-1');
      expect(user1Sessions).toHaveLength(1);
      expect(user1Sessions[0]!.config.id).toBe('bg-1');
    });
  });

  describe('sendMessage', () => {
    it('adds message to session inbox', async () => {
      await manager.startAgent(makeConfig());

      const result = await manager.sendMessage('bg-1', 'user', 'Hello agent');
      expect(result).toBe(true);

      const session = manager.getSession('bg-1');
      expect(session?.inbox).toContain('Hello agent');
    });

    it('returns false for unknown agent', async () => {
      const result = await manager.sendMessage('bg-999', 'user', 'Hello');
      expect(result).toBe(false);
    });
  });

  describe('start (boot)', () => {
    it('resumes interrupted sessions', async () => {
      mockGetInterruptedSessions.mockResolvedValueOnce([
        {
          agentId: 'bg-1',
          config: makeConfig(),
          state: 'running',
        },
      ]);

      await manager.start();

      const session = manager.getSession('bg-1');
      expect(session).not.toBeNull();
    });

    it('starts autoStart agents', async () => {
      mockGetAutoStartAgents.mockResolvedValueOnce([
        makeConfig({ id: 'bg-auto', autoStart: true }),
      ]);

      await manager.start();

      const session = manager.getSession('bg-auto');
      expect(session).not.toBeNull();
    });
  });

  describe('stop (shutdown)', () => {
    it('stops all running agents', async () => {
      // Need to call start() first so the running flag is set
      await manager.start();
      await manager.startAgent(makeConfig({ id: 'bg-1' }));
      await manager.startAgent(makeConfig({ id: 'bg-2' }));

      await manager.stop();

      expect(manager.getSession('bg-1')).toBeNull();
      expect(manager.getSession('bg-2')).toBeNull();
    });
  });

  describe('isRunning', () => {
    it('returns true for running agent', async () => {
      await manager.startAgent(makeConfig());
      expect(manager.isRunning('bg-1')).toBe(true);
    });

    it('returns false for unknown agent', () => {
      expect(manager.isRunning('bg-999')).toBe(false);
    });
  });
});
