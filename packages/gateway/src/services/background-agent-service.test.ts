/**
 * Background Agent Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockManager, mockRepo, MockBackgroundAgentManager } = vi.hoisted(() => {
  const mockManager = {
    isRunning: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    pauseAgent: vi.fn(),
    resumeAgent: vi.fn(),
    getSession: vi.fn(),
    getSessionsByUser: vi.fn(),
    updateAgentConfig: vi.fn(),
    sendMessage: vi.fn(),
    executeNow: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };

  const mockRepo = {
    create: vi.fn(),
    getById: vi.fn(),
    getAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteSession: vi.fn(),
    getHistory: vi.fn(),
    appendToInbox: vi.fn(),
  };

  const MockBackgroundAgentManager = vi.fn(function () {
    return mockManager;
  });

  return { mockManager, mockRepo, MockBackgroundAgentManager };
});

vi.mock('./background-agent-manager.js', () => ({
  BackgroundAgentManager: MockBackgroundAgentManager,
  getBackgroundAgentManager: vi.fn(() => mockManager),
}));

vi.mock('../db/repositories/background-agents.js', () => ({
  getBackgroundAgentsRepository: vi.fn(() => mockRepo),
}));

vi.mock('./log.js', () => ({
  getLog: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() })),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generateId: vi.fn((prefix: string) => `${prefix}-generated`),
    getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
  };
});

import {
  BackgroundAgentServiceImpl,
  getBackgroundAgentService,
} from './background-agent-service.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleConfig = {
  id: 'bg-1',
  userId: 'user-1',
  name: 'My Agent',
  mission: 'Do stuff',
  mode: 'interval',
  allowedTools: [],
  limits: { maxRunsPerDay: 10 },
  autoStart: false,
};

const sampleSession = {
  agentId: 'bg-1',
  status: 'running',
  startedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackgroundAgentServiceImpl', () => {
  let service: BackgroundAgentServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BackgroundAgentServiceImpl(mockManager as any);

    // Default mock returns
    mockRepo.create.mockResolvedValue(sampleConfig);
    mockRepo.getById.mockResolvedValue(sampleConfig);
    mockRepo.getAll.mockResolvedValue([sampleConfig]);
    mockRepo.update.mockResolvedValue(sampleConfig);
    mockRepo.delete.mockResolvedValue(true);
    mockRepo.deleteSession.mockResolvedValue(undefined);
    mockRepo.getHistory.mockResolvedValue({ entries: [], total: 0 });
    mockRepo.appendToInbox.mockResolvedValue(undefined);

    mockManager.isRunning.mockReturnValue(false);
    mockManager.startAgent.mockResolvedValue(sampleSession);
    mockManager.stopAgent.mockResolvedValue(true);
    mockManager.pauseAgent.mockReturnValue(true);
    mockManager.resumeAgent.mockReturnValue(true);
    mockManager.getSession.mockReturnValue(sampleSession);
    mockManager.getSessionsByUser.mockReturnValue([sampleSession]);
    mockManager.sendMessage.mockResolvedValue(true);
    mockManager.executeNow.mockResolvedValue(true);
    mockManager.start.mockResolvedValue(undefined);
    mockManager.stop.mockResolvedValue(undefined);
  });

  // ---- createAgent ----

  describe('createAgent', () => {
    it('creates agent via repo and returns config', async () => {
      const input = {
        userId: 'user-1',
        name: 'My Agent',
        mission: 'Do stuff',
        mode: 'interval' as const,
      };
      const result = await service.createAgent(input as any);
      expect(result).toBe(sampleConfig);
      expect(mockRepo.create).toHaveBeenCalledOnce();
    });

    it('uses default allowedTools=[] when not provided', async () => {
      await service.createAgent({
        userId: 'user-1',
        name: 'Agent',
        mission: 'X',
        mode: 'interval',
      } as any);
      const callArg = mockRepo.create.mock.calls[0]![0];
      expect(callArg.allowedTools).toEqual([]);
    });

    it('uses provided allowedTools', async () => {
      await service.createAgent({
        userId: 'user-1',
        name: 'Agent',
        mission: 'X',
        mode: 'interval',
        allowedTools: ['read_file'],
      } as any);
      const callArg = mockRepo.create.mock.calls[0]![0];
      expect(callArg.allowedTools).toEqual(['read_file']);
    });

    it('autoStart defaults to false', async () => {
      await service.createAgent({
        userId: 'user-1',
        name: 'Agent',
        mission: 'X',
        mode: 'interval',
      } as any);
      const callArg = mockRepo.create.mock.calls[0]![0];
      expect(callArg.autoStart).toBe(false);
    });

    it('createdBy defaults to "user"', async () => {
      await service.createAgent({
        userId: 'user-1',
        name: 'Agent',
        mission: 'X',
        mode: 'interval',
      } as any);
      const callArg = mockRepo.create.mock.calls[0]![0];
      expect(callArg.createdBy).toBe('user');
    });
  });

  // ---- getAgent ----

  describe('getAgent', () => {
    it('returns agent by id', async () => {
      const result = await service.getAgent('bg-1', 'user-1');
      expect(result).toBe(sampleConfig);
      expect(mockRepo.getById).toHaveBeenCalledWith('bg-1', 'user-1');
    });

    it('returns null when not found', async () => {
      mockRepo.getById.mockResolvedValueOnce(null);
      const result = await service.getAgent('nonexistent', 'user-1');
      expect(result).toBeNull();
    });
  });

  // ---- listAgents ----

  describe('listAgents', () => {
    it('returns all agents for userId', async () => {
      const result = await service.listAgents('user-1');
      expect(result).toEqual([sampleConfig]);
      expect(mockRepo.getAll).toHaveBeenCalledWith('user-1');
    });
  });

  // ---- updateAgent ----

  describe('updateAgent', () => {
    it('updates agent and returns updated config', async () => {
      const updates = { name: 'Updated Name' };
      const result = await service.updateAgent('bg-1', 'user-1', updates as any);
      expect(result).toBe(sampleConfig);
      expect(mockRepo.update).toHaveBeenCalledWith('bg-1', 'user-1', updates);
    });

    it('returns null when agent not found in DB', async () => {
      mockRepo.update.mockResolvedValueOnce(null);
      const result = await service.updateAgent('bg-1', 'user-1', {} as any);
      expect(result).toBeNull();
    });

    it('stops and restarts agent when it was running', async () => {
      mockManager.isRunning.mockReturnValueOnce(true);
      await service.updateAgent('bg-1', 'user-1', { name: 'New' } as any);
      expect(mockManager.stopAgent).toHaveBeenCalledWith('bg-1', 'user');
      expect(mockManager.updateAgentConfig).toHaveBeenCalledWith('bg-1', sampleConfig);
      expect(mockManager.startAgent).toHaveBeenCalledWith(sampleConfig);
    });

    it('does not stop/restart when agent was not running', async () => {
      mockManager.isRunning.mockReturnValueOnce(false);
      await service.updateAgent('bg-1', 'user-1', {} as any);
      expect(mockManager.stopAgent).not.toHaveBeenCalled();
      expect(mockManager.startAgent).not.toHaveBeenCalled();
    });

    it('logs error but does not throw when restart fails', async () => {
      mockManager.isRunning.mockReturnValueOnce(true);
      mockManager.startAgent.mockRejectedValueOnce(new Error('Restart failed'));
      const result = await service.updateAgent('bg-1', 'user-1', {} as any);
      // Should still return the updated config
      expect(result).toBe(sampleConfig);
    });
  });

  // ---- deleteAgent ----

  describe('deleteAgent', () => {
    it('deletes agent and returns true', async () => {
      const result = await service.deleteAgent('bg-1', 'user-1');
      expect(result).toBe(true);
      expect(mockRepo.deleteSession).toHaveBeenCalledWith('bg-1');
      expect(mockRepo.delete).toHaveBeenCalledWith('bg-1', 'user-1');
    });

    it('stops agent first when it is running', async () => {
      mockManager.isRunning.mockReturnValueOnce(true);
      await service.deleteAgent('bg-1', 'user-1');
      expect(mockManager.stopAgent).toHaveBeenCalledWith('bg-1', 'user');
    });

    it('does not stop agent when not running', async () => {
      mockManager.isRunning.mockReturnValueOnce(false);
      await service.deleteAgent('bg-1', 'user-1');
      expect(mockManager.stopAgent).not.toHaveBeenCalled();
    });
  });

  // ---- startAgent ----

  describe('startAgent', () => {
    it('starts agent and returns session', async () => {
      const result = await service.startAgent('bg-1', 'user-1');
      expect(result).toBe(sampleSession);
      expect(mockManager.startAgent).toHaveBeenCalledWith(sampleConfig);
    });

    it('throws when agent not found', async () => {
      mockRepo.getById.mockResolvedValueOnce(null);
      await expect(service.startAgent('nonexistent', 'user-1')).rejects.toThrow('Agent not found');
    });
  });

  // ---- pauseAgent ----

  describe('pauseAgent', () => {
    it('pauses agent and returns true', async () => {
      const result = await service.pauseAgent('bg-1', 'user-1');
      expect(result).toBe(true);
      expect(mockManager.pauseAgent).toHaveBeenCalledWith('bg-1');
    });
  });

  // ---- resumeAgent ----

  describe('resumeAgent', () => {
    it('resumes agent and returns true', async () => {
      const result = await service.resumeAgent('bg-1', 'user-1');
      expect(result).toBe(true);
      expect(mockManager.resumeAgent).toHaveBeenCalledWith('bg-1');
    });
  });

  // ---- stopAgent ----

  describe('stopAgent', () => {
    it('stops agent and returns true', async () => {
      const result = await service.stopAgent('bg-1', 'user-1');
      expect(result).toBe(true);
      expect(mockManager.stopAgent).toHaveBeenCalledWith('bg-1', 'user');
    });
  });

  // ---- getSession ----

  describe('getSession', () => {
    it('returns session from manager', () => {
      const result = service.getSession('bg-1', 'user-1');
      expect(result).toBe(sampleSession);
      expect(mockManager.getSession).toHaveBeenCalledWith('bg-1');
    });

    it('returns null when no session', () => {
      mockManager.getSession.mockReturnValueOnce(null);
      const result = service.getSession('bg-1', 'user-1');
      expect(result).toBeNull();
    });
  });

  // ---- listSessions ----

  describe('listSessions', () => {
    it('returns sessions from manager', () => {
      const result = service.listSessions('user-1');
      expect(result).toEqual([sampleSession]);
      expect(mockManager.getSessionsByUser).toHaveBeenCalledWith('user-1');
    });
  });

  // ---- getHistory ----

  describe('getHistory', () => {
    it('returns history from repo with default limit/offset', async () => {
      const result = await service.getHistory('bg-1', 'user-1');
      expect(result).toEqual({ entries: [], total: 0 });
      expect(mockRepo.getHistory).toHaveBeenCalledWith('bg-1', 20, 0);
    });

    it('uses custom limit and offset', async () => {
      await service.getHistory('bg-1', 'user-1', 50, 10);
      expect(mockRepo.getHistory).toHaveBeenCalledWith('bg-1', 50, 10);
    });
  });

  // ---- sendMessage ----

  describe('sendMessage', () => {
    it('appends to inbox and sends to manager', async () => {
      await service.sendMessage('bg-1', 'user-1', 'Hello agent');
      expect(mockRepo.appendToInbox).toHaveBeenCalledWith('bg-1', 'Hello agent');
      expect(mockManager.sendMessage).toHaveBeenCalledWith('bg-1', 'user', 'Hello agent');
    });

    it('throws when agent is not running', async () => {
      mockManager.sendMessage.mockResolvedValueOnce(false);
      await expect(service.sendMessage('bg-1', 'user-1', 'msg')).rejects.toThrow('is not running');
    });
  });

  // ---- executeNow ----

  describe('executeNow', () => {
    it('triggers immediate execution', async () => {
      const result = await service.executeNow('bg-1', 'user-1', 'do this task');
      expect(result).toBe(true);
      expect(mockManager.executeNow).toHaveBeenCalledWith('bg-1', 'do this task');
    });

    it('works without a task', async () => {
      await service.executeNow('bg-1', 'user-1');
      expect(mockManager.executeNow).toHaveBeenCalledWith('bg-1', undefined);
    });
  });

  // ---- start / stop ----

  describe('start', () => {
    it('starts the manager', async () => {
      await service.start();
      expect(mockManager.start).toHaveBeenCalledOnce();
    });
  });

  describe('stop', () => {
    it('stops the manager', async () => {
      await service.stop();
      expect(mockManager.stop).toHaveBeenCalledOnce();
    });
  });
});

// ---- Singleton ----

describe('getBackgroundAgentService', () => {
  it('returns a BackgroundAgentServiceImpl instance', () => {
    const svc = getBackgroundAgentService();
    expect(svc).toBeInstanceOf(BackgroundAgentServiceImpl);
  });
});
