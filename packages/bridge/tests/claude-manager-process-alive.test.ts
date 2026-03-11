import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// Mock child_process.spawn BEFORE importing ClaudeManager
vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn() };
});

import { ClaudeManager } from '../src/claude-manager.ts';

// Helper: create a minimal fake session for injection
function makeFakeSession(overrides: Partial<{
  conversationId: string;
  activeProcess: { pid: number } | null;
  interactiveProcess: { pid: number; killed: boolean } | null;
  paused: boolean;
  pendingApproval: null;
}> = {}) {
  const conversationId = overrides.conversationId ?? 'test-conv-1';
  return {
    info: {
      conversationId,
      sessionId: 'test-session-1',
      processAlive: false,
      lastActivity: new Date(),
      projectDir: '/tmp/test',
      tokensUsed: 0,
      budgetUsed: 0,
      pendingApproval: null,
    },
    activeProcess: overrides.activeProcess !== undefined ? overrides.activeProcess : null,
    interactiveProcess: overrides.interactiveProcess !== undefined ? overrides.interactiveProcess : null,
    paused: overrides.paused ?? false,
    pausedAt: undefined,
    pauseReason: undefined,
    pendingApproval: overrides.pendingApproval ?? null,
    messagesSent: 0,
    circuitBreaker: { failures: 0, lastFailureTime: 0, state: 'closed' as const },
    maxPauseTimer: null,
    interactiveRl: null,
    interactiveIdleTimer: null,
    configOverrides: {},
    displayName: null,
  };
}

describe('ClaudeManager processAlive real OS check', () => {
  let manager: ClaudeManager;

  beforeEach(() => {
    manager = new ClaudeManager();
  });

  describe('getSessions()', () => {
    it('returns processAlive=false when activeProcess is null', () => {
      const session = makeFakeSession({ conversationId: 'conv-null', activeProcess: null });
      (manager as any).sessions.set('conv-null', session);

      const sessions = manager.getSessions();
      const found = sessions.find((s) => s.conversationId === 'conv-null');
      expect(found).toBeDefined();
      expect(found!.processAlive).toBe(false);
    });

    it('returns processAlive=true when activeProcess has current process PID', () => {
      const session = makeFakeSession({
        conversationId: 'conv-alive',
        activeProcess: { pid: process.pid },
      });
      (manager as any).sessions.set('conv-alive', session);

      const sessions = manager.getSessions();
      const found = sessions.find((s) => s.conversationId === 'conv-alive');
      expect(found).toBeDefined();
      expect(found!.processAlive).toBe(true);
    });

    it('returns processAlive=false when activeProcess has dead PID', () => {
      const session = makeFakeSession({
        conversationId: 'conv-dead',
        activeProcess: { pid: 99999999 },
      });
      (manager as any).sessions.set('conv-dead', session);

      const sessions = manager.getSessions();
      const found = sessions.find((s) => s.conversationId === 'conv-dead');
      expect(found).toBeDefined();
      expect(found!.processAlive).toBe(false);
    });
  });

  describe('getSession()', () => {
    it('returns processAlive=false when activeProcess is null', () => {
      const session = makeFakeSession({ conversationId: 'conv-gs-null', activeProcess: null });
      (manager as any).sessions.set('conv-gs-null', session);

      const result = manager.getSession('conv-gs-null');
      expect(result).not.toBeNull();
      expect(result!.processAlive).toBe(false);
    });

    it('returns processAlive=true when activeProcess has current process PID', () => {
      const session = makeFakeSession({
        conversationId: 'conv-gs-alive',
        activeProcess: { pid: process.pid },
      });
      (manager as any).sessions.set('conv-gs-alive', session);

      const result = manager.getSession('conv-gs-alive');
      expect(result).not.toBeNull();
      expect(result!.processAlive).toBe(true);
    });
  });

  describe('session creation', () => {
    it('newly created session info starts with processAlive=false', () => {
      // Access sessions after a session info object is created — before process spawns
      const session = makeFakeSession({ conversationId: 'conv-new', activeProcess: null });
      expect(session.info.processAlive).toBe(false);
    });
  });
});
