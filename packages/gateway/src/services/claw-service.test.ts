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

vi.mock('../db/repositories/claws.js', () => ({
  getClawsRepository: () => ({
    getById: mockGetById,
    getHistory: mockGetHistory,
  }),
}));

vi.mock('./claw-manager.js', () => ({
  getClawManager: () => ({
    getSession: mockGetSession,
    executeNow: mockExecuteNow,
    sendMessage: mockSendMessage,
    approveEscalation: mockApproveEscalation,
    denyEscalation: mockDenyEscalation,
  }),
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
      mockExecuteNow.mockResolvedValue({ toolCalls: [], durationMs: 100 });
      const result = await service.executeNow('claw-1', 'user-1');
      expect(result).toBeDefined();
      expect(mockExecuteNow).toHaveBeenCalledWith('claw-1');
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
});
