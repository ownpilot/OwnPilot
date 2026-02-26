/**
 * Tests for CodingAgentSessionManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock PTY/spawn functions
const mockSpawnStreamingPty = vi.fn();
const mockSpawnStreamingProcess = vi.fn();
vi.mock('./coding-agent-pty.js', () => ({
  spawnStreamingPty: (...args: unknown[]) => mockSpawnStreamingPty(...args),
  spawnStreamingProcess: (...args: unknown[]) => mockSpawnStreamingProcess(...args),
}));

// Mock WS session manager
const mockWsSend = vi.fn();
const mockWsBroadcast = vi.fn();
vi.mock('../ws/session.js', () => ({
  sessionManager: {
    send: (...args: unknown[]) => mockWsSend(...args),
    broadcast: (...args: unknown[]) => mockWsBroadcast(...args),
  },
}));

// Mock log
vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// =============================================================================
// Helpers
// =============================================================================

function createMockPtyHandle() {
  return {
    pid: 12345,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    dispose: vi.fn(),
  };
}

function defaultInput() {
  return {
    provider: 'codex' as const,
    prompt: 'Fix the bug',
    cwd: '/tmp/test',
    mode: 'auto' as const,
  };
}

const USER_A = 'user-a';
const USER_B = 'user-b';

// =============================================================================
// Tests
// =============================================================================

describe('CodingAgentSessionManager', () => {
  let CodingAgentSessionManager: typeof import('./coding-agent-sessions.js').CodingAgentSessionManager;
  let manager: InstanceType<typeof CodingAgentSessionManager>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const mod = await import('./coding-agent-sessions.js');
    CodingAgentSessionManager = mod.CodingAgentSessionManager;
    manager = new CodingAgentSessionManager();
  });

  afterEach(() => {
    manager.stop();
  });

  // ===========================================================================
  // createSession
  // ===========================================================================

  describe('createSession', () => {
    it('spawns PTY and returns session info', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(
        defaultInput(),
        USER_A,
        { PATH: '/usr/bin' },
        'codex',
        ['exec', '--full-auto', 'Fix the bug']
      );

      expect(session.id).toBeTruthy();
      expect(session.provider).toBe('codex');
      expect(session.state).toBe('running');
      expect(session.mode).toBe('auto');
      expect(session.prompt).toBe('Fix the bug');
      expect(session.userId).toBe(USER_A);
      expect(session.displayName).toContain('Codex');

      expect(mockSpawnStreamingProcess).toHaveBeenCalledWith(
        'codex',
        ['exec', '--full-auto', 'Fix the bug'],
        expect.objectContaining({ cwd: '/tmp/test' }),
        expect.objectContaining({
          onData: expect.any(Function),
          onExit: expect.any(Function),
          onError: expect.any(Function),
        })
      );
    });

    it('enforces max 3 sessions per user', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      // Create 3 sessions
      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);

      // Fourth should fail
      await expect(manager.createSession(defaultInput(), USER_A, {}, 'codex', [])).rejects.toThrow(
        'Maximum 3 concurrent sessions allowed'
      );
    });

    it('allows different users to each have 3 sessions', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      // User A creates 3
      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);

      // User B can still create sessions
      const session = await manager.createSession(defaultInput(), USER_B, {}, 'codex', []);
      expect(session.userId).toBe(USER_B);
    });

    it('cleans up on spawn failure', async () => {
      mockSpawnStreamingProcess.mockImplementation(() => {
        throw new Error('spawn failed');
      });

      await expect(manager.createSession(defaultInput(), USER_A, {}, 'codex', [])).rejects.toThrow(
        'spawn failed'
      );

      // Session should not remain
      expect(manager.listSessions(USER_A)).toHaveLength(0);
    });
  });

  // ===========================================================================
  // getSession / listSessions
  // ===========================================================================

  describe('getSession / listSessions', () => {
    it('returns session for correct user', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      expect(manager.getSession(session.id, USER_A)).toBeDefined();
    });

    it('returns undefined for wrong user', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      expect(manager.getSession(session.id, USER_B)).toBeUndefined();
    });

    it('lists all sessions for a user', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);

      expect(manager.listSessions(USER_A)).toHaveLength(2);
      expect(manager.listSessions(USER_B)).toHaveLength(0);
    });
  });

  // ===========================================================================
  // writeToSession / resizeSession
  // ===========================================================================

  describe('writeToSession / resizeSession', () => {
    it('delegates write to PtyHandle', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      const ok = manager.writeToSession(session.id, USER_A, 'hello');
      expect(ok).toBe(true);
      expect(ptyHandle.write).toHaveBeenCalledWith('hello');
    });

    it('rejects write from wrong user', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      expect(manager.writeToSession(session.id, USER_B, 'hello')).toBe(false);
    });

    it('delegates resize to PtyHandle', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      const ok = manager.resizeSession(session.id, USER_A, 80, 24);
      expect(ok).toBe(true);
      expect(ptyHandle.resize).toHaveBeenCalledWith(80, 24);
    });
  });

  // ===========================================================================
  // terminateSession
  // ===========================================================================

  describe('terminateSession', () => {
    it('kills PTY and updates state', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      const ok = manager.terminateSession(session.id, USER_A);
      expect(ok).toBe(true);
      expect(ptyHandle.kill).toHaveBeenCalledWith('SIGTERM');
      expect(ptyHandle.dispose).toHaveBeenCalled();

      const updated = manager.getSession(session.id, USER_A);
      expect(updated?.state).toBe('terminated');
    });

    it('returns false for wrong user', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      expect(manager.terminateSession(session.id, USER_B)).toBe(false);
    });

    it('allows new session after termination', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      // Fill up 3 sessions
      const s1 = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);

      // Terminate one
      manager.terminateSession(s1.id, USER_A);

      // Should be able to create another
      const s4 = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      expect(s4.state).toBe('running');
    });
  });

  // ===========================================================================
  // PTY callbacks
  // ===========================================================================

  describe('PTY callbacks', () => {
    it('onData sends targeted WS event to subscribers', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);

      // Subscribe a WS session
      manager.subscribe(session.id, 'ws-1', USER_A);
      mockWsSend.mockClear();

      // Trigger onData callback
      const callbacks = mockSpawnStreamingProcess.mock.calls[0][3];
      callbacks.onData('test output');

      expect(mockWsSend).toHaveBeenCalledWith('ws-1', 'coding-agent:session:output', {
        sessionId: session.id,
        data: 'test output',
      });
    });

    it('onExit updates state and broadcasts', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      manager.subscribe(session.id, 'ws-1', USER_A);
      mockWsSend.mockClear();

      // Trigger onExit callback
      const callbacks = mockSpawnStreamingProcess.mock.calls[0][3];
      callbacks.onExit(0);

      const updated = manager.getSession(session.id, USER_A);
      expect(updated?.state).toBe('completed');
      expect(updated?.exitCode).toBe(0);

      // Should have sent exit + state events
      expect(mockWsSend).toHaveBeenCalledWith(
        'ws-1',
        'coding-agent:session:exit',
        expect.objectContaining({ sessionId: session.id, exitCode: 0 })
      );
      expect(mockWsSend).toHaveBeenCalledWith('ws-1', 'coding-agent:session:state', {
        sessionId: session.id,
        state: 'completed',
      });
    });

    it('onExit with non-zero code sets failed state', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      const callbacks = mockSpawnStreamingProcess.mock.calls[0][3];
      callbacks.onExit(1);

      const updated = manager.getSession(session.id, USER_A);
      expect(updated?.state).toBe('failed');
    });

    it('onError updates state and sends error event', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      manager.subscribe(session.id, 'ws-1', USER_A);
      mockWsSend.mockClear();

      const callbacks = mockSpawnStreamingProcess.mock.calls[0][3];
      callbacks.onError('spawn error');

      const updated = manager.getSession(session.id, USER_A);
      expect(updated?.state).toBe('failed');

      expect(mockWsSend).toHaveBeenCalledWith('ws-1', 'coding-agent:session:error', {
        sessionId: session.id,
        error: 'spawn error',
      });
    });
  });

  // ===========================================================================
  // WS Subscriber Management
  // ===========================================================================

  describe('subscribe / unsubscribe', () => {
    it('subscribe replays output buffer', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);

      // Trigger some output
      const callbacks = mockSpawnStreamingProcess.mock.calls[0][3];
      callbacks.onData('line 1\n');
      callbacks.onData('line 2\n');

      // Now subscribe
      mockWsSend.mockClear();
      manager.subscribe(session.id, 'ws-1', USER_A);

      // Should receive replay + current state
      expect(mockWsSend).toHaveBeenCalledWith('ws-1', 'coding-agent:session:output', {
        sessionId: session.id,
        data: 'line 1\nline 2\n',
      });
      expect(mockWsSend).toHaveBeenCalledWith('ws-1', 'coding-agent:session:state', {
        sessionId: session.id,
        state: 'running',
      });
    });

    it('subscribe returns false for wrong user', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      expect(manager.subscribe(session.id, 'ws-1', USER_B)).toBe(false);
    });

    it('unsubscribe stops output delivery', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      manager.subscribe(session.id, 'ws-1', USER_A);
      manager.unsubscribe(session.id, 'ws-1');
      mockWsSend.mockClear();

      // New output should not be sent to unsubscribed client
      const callbacks = mockSpawnStreamingProcess.mock.calls[0][3];
      callbacks.onData('after unsub');

      // mockWsSend should not be called (no subscribers left)
      expect(mockWsSend).not.toHaveBeenCalled();
    });

    it('removeSubscriber cleans up from all sessions', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const s1 = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      const s2 = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);

      manager.subscribe(s1.id, 'ws-1', USER_A);
      manager.subscribe(s2.id, 'ws-1', USER_A);

      // Remove subscriber globally
      manager.removeSubscriber('ws-1');
      mockWsSend.mockClear();

      // Output to either session should not reach ws-1
      const cb1 = mockSpawnStreamingProcess.mock.calls[0][3];
      const cb2 = mockSpawnStreamingProcess.mock.calls[1][3];
      cb1.onData('hello');
      cb2.onData('world');

      expect(mockWsSend).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Output ring buffer
  // ===========================================================================

  describe('output ring buffer', () => {
    it('caps at 100KB', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      const callbacks = mockSpawnStreamingProcess.mock.calls[0][3];

      // Write more than 100KB
      const bigChunk = 'x'.repeat(60_000);
      callbacks.onData(bigChunk);
      callbacks.onData(bigChunk); // Total: 120KB

      const buffer = manager.getOutputBuffer(session.id, USER_A);
      expect(buffer).toBeDefined();
      expect(buffer!.length).toBeLessThanOrEqual(102_400);
      // Should keep the tail
      expect(buffer!.endsWith('x')).toBe(true);
    });

    it('returns undefined for wrong user', async () => {
      const ptyHandle = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValue(ptyHandle);

      const session = await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      expect(manager.getOutputBuffer(session.id, USER_B)).toBeUndefined();
    });
  });

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  describe('cleanup', () => {
    it('stop terminates all active PTY processes', async () => {
      const ptyHandle1 = createMockPtyHandle();
      const ptyHandle2 = createMockPtyHandle();
      mockSpawnStreamingProcess.mockReturnValueOnce(ptyHandle1).mockReturnValueOnce(ptyHandle2);

      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);
      await manager.createSession(defaultInput(), USER_A, {}, 'codex', []);

      manager.stop();

      expect(ptyHandle1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(ptyHandle1.dispose).toHaveBeenCalled();
      expect(ptyHandle2.kill).toHaveBeenCalledWith('SIGTERM');
      expect(ptyHandle2.dispose).toHaveBeenCalled();
    });
  });
});
