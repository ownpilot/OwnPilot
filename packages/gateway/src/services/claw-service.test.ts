/**
 * Tests for ClawService authorization — ensures every method that
 * accepts userId properly validates ownership before proceeding.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetById = vi.fn();
const mockGetHistory = vi.fn();
const mockGetSession = vi.fn();
const mockExecuteNow = vi.fn();
const mockSendMessage = vi.fn();
const mockApproveEscalation = vi.fn();
const mockDenyEscalation = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockGetByIdAnyUser = vi.fn();

vi.mock('../db/repositories/claws.js', () => ({
  getClawsRepository: () => ({
    getById: mockGetById,
    getHistory: mockGetHistory,
    create: mockCreate,
    update: mockUpdate,
    getByIdAnyUser: mockGetByIdAnyUser,
    delete: mockDelete,
  }),
}));

const mockIsRunning = vi.fn();
const mockStopClaw = vi.fn();
const mockPauseClaw = vi.fn();
const mockResumeClaw = vi.fn();
const mockDelete = vi.fn();
const mockDeleteSessionWorkspace = vi.fn();

vi.mock('./claw-manager.js', () => ({
  getClawManager: () => ({
    getSession: mockGetSession,
    executeNow: mockExecuteNow,
    sendMessage: mockSendMessage,
    approveEscalation: mockApproveEscalation,
    denyEscalation: mockDenyEscalation,
    isRunning: mockIsRunning,
    stopClaw: mockStopClaw,
    pauseClaw: mockPauseClaw,
    resumeClaw: mockResumeClaw,
  }),
}));

vi.mock('../workspace/file-workspace.js', () => ({
  deleteSessionWorkspace: mockDeleteSessionWorkspace,
}));

import { ClawServiceImpl } from './claw-service.js';

describe('ClawService authorization', () => {
  let service: ClawServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClawServiceImpl();
  });

  describe('executeNow', () => {
    it('throws when claw does not belong to user', async () => {
      mockGetById.mockResolvedValue(null);
      await expect(service.executeNow('claw-1', 'wrong-user')).rejects.toThrow('Claw not found');
      expect(mockExecuteNow).not.toHaveBeenCalled();
    });

    it('proceeds when claw belongs to user', async () => {
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1' });
      // executeNow now requires a live session — mock one in 'running' state.
      mockGetSession.mockReturnValue({
        config: { id: 'claw-1', userId: 'user-1' },
        state: 'running',
      });
      mockExecuteNow.mockResolvedValue({ toolCalls: [], durationMs: 100 });
      const result = await service.executeNow('claw-1', 'user-1');
      expect(result).toBeDefined();
      expect(mockExecuteNow).toHaveBeenCalledWith('claw-1');
    });

    it('throws a specific error when the claw is not running', async () => {
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1' });
      mockGetSession.mockReturnValue(null);
      await expect(service.executeNow('claw-1', 'user-1')).rejects.toThrow('not running');
      expect(mockExecuteNow).not.toHaveBeenCalled();
    });

    it('throws when the claw is paused', async () => {
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1' });
      mockGetSession.mockReturnValue({
        config: { id: 'claw-1', userId: 'user-1' },
        state: 'paused',
      });
      await expect(service.executeNow('claw-1', 'user-1')).rejects.toThrow('paused');
      expect(mockExecuteNow).not.toHaveBeenCalled();
    });

    it('throws when the claw is awaiting escalation approval', async () => {
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1' });
      mockGetSession.mockReturnValue({
        config: { id: 'claw-1', userId: 'user-1' },
        state: 'escalation_pending',
      });
      await expect(service.executeNow('claw-1', 'user-1')).rejects.toThrow('escalation');
      expect(mockExecuteNow).not.toHaveBeenCalled();
    });

    it('throws "cycle in progress" when manager returns null mid-cycle', async () => {
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1' });
      mockGetSession.mockReturnValue({
        config: { id: 'claw-1', userId: 'user-1' },
        state: 'running',
      });
      mockExecuteNow.mockResolvedValue(null);
      await expect(service.executeNow('claw-1', 'user-1')).rejects.toThrow(
        'Cycle in progress'
      );
    });
  });

  describe('getSession', () => {
    it('returns null when session userId does not match', () => {
      mockGetSession.mockReturnValue({
        config: { userId: 'user-1' },
        state: 'running',
      });
      expect(service.getSession('claw-1', 'wrong-user')).toBeNull();
    });

    it('returns session when userId matches', () => {
      const session = { config: { userId: 'user-1' }, state: 'running' };
      mockGetSession.mockReturnValue(session);
      expect(service.getSession('claw-1', 'user-1')).toBe(session);
    });

    it('returns null when session does not exist', () => {
      mockGetSession.mockReturnValue(null);
      expect(service.getSession('claw-1', 'user-1')).toBeNull();
    });
  });

  describe('getHistory', () => {
    it('returns empty when claw does not belong to user', async () => {
      mockGetById.mockResolvedValue(null);
      const result = await service.getHistory('claw-1', 'wrong-user');
      expect(result).toEqual({ entries: [], total: 0 });
      expect(mockGetHistory).not.toHaveBeenCalled();
    });

    it('returns history when claw belongs to user', async () => {
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1' });
      mockGetHistory.mockResolvedValue({ entries: [{ id: 'h1' }], total: 1 });
      const result = await service.getHistory('claw-1', 'user-1');
      expect(result.total).toBe(1);
    });
  });

  describe('sendMessage', () => {
    it('throws when claw does not belong to user', async () => {
      mockGetById.mockResolvedValue(null);
      await expect(service.sendMessage('claw-1', 'wrong-user', 'hi')).rejects.toThrow(
        'Claw not found'
      );
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('approveEscalation', () => {
    it('returns false when claw does not belong to user', async () => {
      mockGetById.mockResolvedValue(null);
      expect(await service.approveEscalation('claw-1', 'wrong-user')).toBe(false);
      expect(mockApproveEscalation).not.toHaveBeenCalled();
    });
  });

  describe('denyEscalation', () => {
    it('returns false when claw does not belong to user', async () => {
      mockGetById.mockResolvedValue(null);
      expect(await service.denyEscalation('claw-1', 'wrong-user', 'nope')).toBe(false);
      expect(mockDenyEscalation).not.toHaveBeenCalled();
    });
  });

  describe('pauseClaw ownership', () => {
    it('returns false and skips manager when claw does not belong to user', async () => {
      mockGetById.mockResolvedValue(null);
      expect(await service.pauseClaw('claw-1', 'wrong-user')).toBe(false);
      expect(mockPauseClaw).not.toHaveBeenCalled();
    });

    it('proceeds when claw belongs to user', async () => {
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1' });
      mockPauseClaw.mockResolvedValue(true);
      expect(await service.pauseClaw('claw-1', 'user-1')).toBe(true);
      expect(mockPauseClaw).toHaveBeenCalledWith('claw-1', 'user-1');
    });
  });

  describe('resumeClaw ownership', () => {
    it('returns false and skips manager when claw does not belong to user', async () => {
      mockGetById.mockResolvedValue(null);
      expect(await service.resumeClaw('claw-1', 'wrong-user')).toBe(false);
      expect(mockResumeClaw).not.toHaveBeenCalled();
    });
  });

  describe('stopClaw ownership', () => {
    it('returns false and skips manager when claw does not belong to user', async () => {
      mockGetById.mockResolvedValue(null);
      expect(await service.stopClaw('claw-1', 'wrong-user')).toBe(false);
      expect(mockStopClaw).not.toHaveBeenCalled();
    });
  });

  describe('createClaw limit validation', () => {
    function makeInput(overrides: Record<string, unknown> = {}) {
      return {
        userId: 'user-1',
        name: 'Test',
        mission: 'Do things',
        ...overrides,
      } as Parameters<typeof service.createClaw>[0];
    }

    it('rejects negative maxToolCallsPerCycle', async () => {
      await expect(
        service.createClaw(
          makeInput({
            limits: {
              maxTurnsPerCycle: 10,
              maxToolCallsPerCycle: -1,
              maxCyclesPerHour: 10,
              cycleTimeoutMs: 60000,
            },
          })
        )
      ).rejects.toThrow(/maxToolCallsPerCycle/);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects zero maxCyclesPerHour', async () => {
      await expect(
        service.createClaw(
          makeInput({
            limits: {
              maxTurnsPerCycle: 10,
              maxToolCallsPerCycle: 50,
              maxCyclesPerHour: 0,
              cycleTimeoutMs: 60000,
            },
          })
        )
      ).rejects.toThrow(/maxCyclesPerHour/);
    });

    it('rejects cycleTimeoutMs above 1 hour cap', async () => {
      await expect(
        service.createClaw(
          makeInput({
            limits: {
              maxTurnsPerCycle: 10,
              maxToolCallsPerCycle: 50,
              maxCyclesPerHour: 10,
              cycleTimeoutMs: 3_600_001,
            },
          })
        )
      ).rejects.toThrow(/cycleTimeoutMs/);
    });

    it('rejects negative totalBudgetUsd', async () => {
      await expect(
        service.createClaw(
          makeInput({
            limits: {
              maxTurnsPerCycle: 10,
              maxToolCallsPerCycle: 50,
              maxCyclesPerHour: 10,
              cycleTimeoutMs: 60000,
              totalBudgetUsd: -5,
            },
          })
        )
      ).rejects.toThrow(/totalBudgetUsd/);
    });

    it('rejects interval mode without intervalMs', async () => {
      await expect(service.createClaw(makeInput({ mode: 'interval' }))).rejects.toThrow(
        /intervalMs/
      );
    });

    it('rejects intervalMs below 1 second', async () => {
      await expect(
        service.createClaw(makeInput({ mode: 'interval', intervalMs: 500 }))
      ).rejects.toThrow(/intervalMs/);
    });

    it('rejects intervalMs above 24 hours', async () => {
      await expect(
        service.createClaw(makeInput({ mode: 'interval', intervalMs: 86_400_001 }))
      ).rejects.toThrow(/intervalMs/);
    });

    it('rejects mission longer than 10000 chars', async () => {
      await expect(
        service.createClaw(makeInput({ mission: 'x'.repeat(10_001) }))
      ).rejects.toThrow(/10,000/);
    });

    it('accepts a valid config', async () => {
      mockCreate.mockResolvedValue({ id: 'claw-new' });
      const result = await service.createClaw(
        makeInput({
          limits: {
            maxTurnsPerCycle: 10,
            maxToolCallsPerCycle: 50,
            maxCyclesPerHour: 10,
            cycleTimeoutMs: 60000,
          },
        })
      );
      expect(result).toEqual({ id: 'claw-new' });
      expect(mockCreate).toHaveBeenCalled();
    });
  });

  describe('deleteClaw workspace cleanup', () => {
    it('deletes the workspace dir after the row is deleted', async () => {
      mockIsRunning.mockReturnValue(false);
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1', workspaceId: 'ws-7' });
      mockDelete.mockResolvedValue(true);

      const result = await service.deleteClaw('claw-1', 'user-1');

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('claw-1', 'user-1');
      expect(mockDeleteSessionWorkspace).toHaveBeenCalledWith('ws-7');
    });

    it('does not touch workspace when claw row delete fails', async () => {
      mockIsRunning.mockReturnValue(false);
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1', workspaceId: 'ws-7' });
      mockDelete.mockResolvedValue(false);

      const result = await service.deleteClaw('claw-1', 'user-1');

      expect(result).toBe(false);
      expect(mockDeleteSessionWorkspace).not.toHaveBeenCalled();
    });

    it('skips workspace cleanup when claw has no workspaceId', async () => {
      mockIsRunning.mockReturnValue(false);
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1', workspaceId: null });
      mockDelete.mockResolvedValue(true);

      const result = await service.deleteClaw('claw-1', 'user-1');

      expect(result).toBe(true);
      expect(mockDeleteSessionWorkspace).not.toHaveBeenCalled();
    });

    it('stops a running claw before deleting', async () => {
      mockIsRunning.mockReturnValue(true);
      mockStopClaw.mockResolvedValue(true);
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1', workspaceId: 'ws-7' });
      mockDelete.mockResolvedValue(true);

      await service.deleteClaw('claw-1', 'user-1');

      expect(mockStopClaw).toHaveBeenCalledWith('claw-1', 'user-1');
      expect(mockDelete).toHaveBeenCalled();
    });

    it('swallows workspace delete errors so DB delete still succeeds', async () => {
      mockIsRunning.mockReturnValue(false);
      mockGetById.mockResolvedValue({ id: 'claw-1', userId: 'user-1', workspaceId: 'ws-7' });
      mockDelete.mockResolvedValue(true);
      mockDeleteSessionWorkspace.mockImplementation(() => {
        throw new Error('disk error');
      });

      const result = await service.deleteClaw('claw-1', 'user-1');

      expect(result).toBe(true);
    });
  });
});
