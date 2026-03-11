import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeManager } from '../src/claude-manager.ts';

/**
 * Unit tests for pendingApproval tracking in ClaudeManager.
 * Tests setPendingApproval, clearPendingApproval, getPendingSessions.
 */

describe('ClaudeManager pendingApproval', () => {
  let manager: ClaudeManager;

  beforeEach(() => {
    manager = new ClaudeManager();
  });

  // ---- setPendingApproval ----

  describe('setPendingApproval', () => {
    it('returns false for non-existent session', () => {
      expect(manager.setPendingApproval('nonexistent', 'QUESTION', 'test?')).toBe(false);
    });

    it('sets pending approval on existing session', async () => {
      await manager.getOrCreate('conv-1');
      expect(manager.setPendingApproval('conv-1', 'QUESTION', 'Which DB?')).toBe(true);

      const session = manager.getSession('conv-1');
      expect(session?.pendingApproval).not.toBeNull();
      expect(session?.pendingApproval?.pattern).toBe('QUESTION');
      expect(session?.pendingApproval?.text).toBe('Which DB?');
      expect(session?.pendingApproval?.detectedAt).toBeGreaterThan(0);
    });

    it('sets TASK_BLOCKED pattern', async () => {
      await manager.getOrCreate('conv-2');
      expect(manager.setPendingApproval('conv-2', 'TASK_BLOCKED', 'Missing config')).toBe(true);

      const session = manager.getSession('conv-2');
      expect(session?.pendingApproval?.pattern).toBe('TASK_BLOCKED');
      expect(session?.pendingApproval?.text).toBe('Missing config');
    });

    it('overwrites existing pending approval', async () => {
      await manager.getOrCreate('conv-3');
      manager.setPendingApproval('conv-3', 'QUESTION', 'First question?');
      manager.setPendingApproval('conv-3', 'TASK_BLOCKED', 'Now blocked');

      const session = manager.getSession('conv-3');
      expect(session?.pendingApproval?.pattern).toBe('TASK_BLOCKED');
      expect(session?.pendingApproval?.text).toBe('Now blocked');
    });
  });

  // ---- clearPendingApproval ----

  describe('clearPendingApproval', () => {
    it('returns false for non-existent session', () => {
      expect(manager.clearPendingApproval('nonexistent')).toBe(false);
    });

    it('clears pending approval', async () => {
      await manager.getOrCreate('conv-4');
      manager.setPendingApproval('conv-4', 'QUESTION', 'test?');
      expect(manager.clearPendingApproval('conv-4')).toBe(true);

      const session = manager.getSession('conv-4');
      expect(session?.pendingApproval).toBeNull();
    });

    it('is safe to call when no pending approval', async () => {
      await manager.getOrCreate('conv-5');
      expect(manager.clearPendingApproval('conv-5')).toBe(true);

      const session = manager.getSession('conv-5');
      expect(session?.pendingApproval).toBeNull();
    });
  });

  // ---- getPendingSessions ----

  describe('getPendingSessions', () => {
    it('returns empty array when no sessions', () => {
      expect(manager.getPendingSessions()).toEqual([]);
    });

    it('returns empty when sessions exist but none pending', async () => {
      await manager.getOrCreate('conv-6');
      await manager.getOrCreate('conv-7');
      expect(manager.getPendingSessions()).toEqual([]);
    });

    it('returns only sessions with pending approval', async () => {
      await manager.getOrCreate('conv-8');
      await manager.getOrCreate('conv-9');
      await manager.getOrCreate('conv-10');

      manager.setPendingApproval('conv-8', 'QUESTION', 'Q1?');
      manager.setPendingApproval('conv-10', 'TASK_BLOCKED', 'Blocked');

      const pending = manager.getPendingSessions();
      expect(pending).toHaveLength(2);

      const convIds = pending.map((s) => s.conversationId).sort();
      expect(convIds).toEqual(['conv-10', 'conv-8']);

      const q1 = pending.find((s) => s.conversationId === 'conv-8');
      expect(q1?.pendingApproval.pattern).toBe('QUESTION');
      expect(q1?.pendingApproval.text).toBe('Q1?');

      const blocked = pending.find((s) => s.conversationId === 'conv-10');
      expect(blocked?.pendingApproval.pattern).toBe('TASK_BLOCKED');
    });

    it('excludes sessions after clearPendingApproval', async () => {
      await manager.getOrCreate('conv-11');
      await manager.getOrCreate('conv-12');

      manager.setPendingApproval('conv-11', 'QUESTION', 'Q?');
      manager.setPendingApproval('conv-12', 'QUESTION', 'Q2?');

      manager.clearPendingApproval('conv-11');

      const pending = manager.getPendingSessions();
      expect(pending).toHaveLength(1);
      expect(pending[0].conversationId).toBe('conv-12');
    });
  });

  // ---- pendingApproval in getSessions / getSession ----

  describe('pendingApproval visibility in getSessions/getSession', () => {
    it('getSessions includes pendingApproval field', async () => {
      await manager.getOrCreate('conv-13');
      manager.setPendingApproval('conv-13', 'QUESTION', 'Visible?');

      const sessions = manager.getSessions();
      const s = sessions.find((s) => s.conversationId === 'conv-13');
      expect(s?.pendingApproval?.pattern).toBe('QUESTION');
    });

    it('getSession includes pendingApproval field', async () => {
      await manager.getOrCreate('conv-14');
      manager.setPendingApproval('conv-14', 'TASK_BLOCKED', 'Block text');

      const s = manager.getSession('conv-14');
      expect(s?.pendingApproval?.pattern).toBe('TASK_BLOCKED');
      expect(s?.pendingApproval?.text).toBe('Block text');
    });

    it('new session has null pendingApproval', async () => {
      const info = await manager.getOrCreate('conv-15');
      expect(info.pendingApproval).toBeNull();

      const s = manager.getSession('conv-15');
      expect(s?.pendingApproval).toBeNull();
    });
  });

  // ---- terminate clears pending ----

  describe('terminate clears pending state', () => {
    it('terminated session no longer appears in getPendingSessions', async () => {
      await manager.getOrCreate('conv-16');
      manager.setPendingApproval('conv-16', 'QUESTION', 'Gone?');

      expect(manager.getPendingSessions()).toHaveLength(1);
      manager.terminate('conv-16');
      expect(manager.getPendingSessions()).toHaveLength(0);
    });
  });
});
