/**
 * runViaInteractive — dedicated coverage tests.
 *
 * Tests the internal runViaInteractive() generator: error paths, serialization,
 * and listener cleanup. All tests call send() (the public API) which routes
 * exclusively through runViaInteractive().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// Mock child_process BEFORE importing ClaudeManager
vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn() };
});

// Fake PIDs treated as alive (consistent with interactive-session tests)
vi.mock('../src/process-alive.ts', () => ({
  isProcessAlive: (pid: number | null | undefined) => pid != null,
}));

import { spawn } from 'node:child_process';
import { ClaudeManager } from '../src/claude-manager.ts';
import { eventBus } from '../src/event-bus.ts';

// ---------------------------------------------------------------------------
// FakeProc for interactive mode
// ---------------------------------------------------------------------------

class FakeProc extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  killed = false;

  constructor(pid = 12345) {
    super();
    this.pid = pid;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin.on('error', () => {});
    this.stdout.on('error', () => {});
    this.stderr.on('error', () => {});
  }

  /**
   * Queue NDJSON lines to be sent when readline starts consuming stdout.
   * Also sets up auto-exit when stdin is ended (for quick closeInteractive).
   */
  sendLines(lines: string[], exitCode = 0): void {
    // Auto-exit when closeInteractive calls stdin.end()
    this.stdin.once('finish', () => {
      setTimeout(() => this.emit('exit', exitCode, null), 10);
    });

    const doSend = () => {
      for (const line of lines) {
        this.stdout.push(line + '\n');
      }
    };
    // readline calls stdout.resume() when it attaches — push data then
    this.stdout.once('resume', doSend);
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.emit('exit', null, signal ?? 'SIGTERM');
    return true;
  }
}

function makeProc(pid?: number): FakeProc {
  return new FakeProc(pid);
}

function mockSpawnOnce(proc: FakeProc): void {
  vi.mocked(spawn).mockReturnValueOnce(proc as unknown as ReturnType<typeof spawn>);
}

const resultLine = (text = 'OK') =>
  JSON.stringify({ type: 'result', result: text, usage: { input_tokens: 10, output_tokens: 5 } });

const deltaLine = (text: string) =>
  JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } });

async function collectChunks(
  manager: ClaudeManager,
  convId: string,
  message = 'hello',
  projectDir = '/tmp/test',
) {
  const chunks = [];
  for await (const chunk of manager.send(convId, message, projectDir)) {
    chunks.push(chunk);
  }
  return chunks;
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runViaInteractive', () => {
  let manager: ClaudeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus.removeAllListeners();
    manager = new ClaudeManager();
  });

  afterEach(async () => {
    await manager.shutdownAll();
    eventBus.removeAllListeners();
  });

  // =========================================================================
  // Error paths
  // =========================================================================

  describe('error paths', () => {
    it('yields error chunk when spawn throws during startInteractive', async () => {
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('spawn ENOENT: claude not found');
      });

      await manager.getOrCreate('conv-spawn-throw', { projectDir: '/tmp/test' });
      const chunks = await collectChunks(manager, 'conv-spawn-throw');

      const errChunk = chunks.find((c) => c.type === 'error');
      expect(errChunk).toBeDefined();
      expect((errChunk as { type: string; error: string }).error).toContain('ENOENT');
    });

    it('error chunk message includes "Interactive CC failed" on spawn throw', async () => {
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await manager.getOrCreate('conv-spawn-msg', { projectDir: '/tmp/test' });
      const chunks = await collectChunks(manager, 'conv-spawn-msg');

      const errChunk = chunks.find((c) => c.type === 'error') as { type: string; error: string } | undefined;
      expect(errChunk?.error).toContain('Interactive CC failed');
    });

    it('yields error chunk when writeToSession returns false', async () => {
      const proc = makeProc();
      proc.sendLines([resultLine()]);
      mockSpawnOnce(proc);

      await manager.getOrCreate('conv-write-false', { projectDir: '/tmp/test' });
      // Spy on writeToSession to return false — simulates dead stdin after spawn
      vi.spyOn(manager, 'writeToSession').mockReturnValueOnce(false);

      const chunks = await collectChunks(manager, 'conv-write-false');

      const errChunk = chunks.find((c) => c.type === 'error') as { type: string; error: string } | undefined;
      expect(errChunk).toBeDefined();
      expect(errChunk?.error).toContain('Failed to write message to interactive session');
    });
  });

  // =========================================================================
  // Normal completion
  // =========================================================================

  describe('normal completion', () => {
    it('yields text and done chunks on successful CC result', async () => {
      const proc = makeProc();
      proc.sendLines([deltaLine('Hello!'), resultLine()]);
      mockSpawnOnce(proc);

      await manager.getOrCreate('conv-normal', { projectDir: '/tmp/test' });
      const chunks = await collectChunks(manager, 'conv-normal');

      expect(chunks.some((c) => c.type === 'text')).toBe(true);
      expect(chunks.some((c) => c.type === 'done')).toBe(true);
      expect(chunks.find((c) => c.type === 'error')).toBeUndefined();
    });

    it('done chunk carries usage from CC result event', async () => {
      const proc = makeProc();
      proc.sendLines([
        JSON.stringify({ type: 'result', result: '', usage: { input_tokens: 42, output_tokens: 17 } }),
      ]);
      mockSpawnOnce(proc);

      await manager.getOrCreate('conv-usage', { projectDir: '/tmp/test' });
      const chunks = await collectChunks(manager, 'conv-usage');

      const doneChunk = chunks.find((c) => c.type === 'done') as { type: string; usage?: { input_tokens: number; output_tokens: number } } | undefined;
      expect(doneChunk?.usage).toEqual({ input_tokens: 42, output_tokens: 17 });
    });
  });

  // =========================================================================
  // pendingChain — same-session serialization
  // =========================================================================

  describe('pendingChain serialization', () => {
    it('serializes two concurrent send() calls on same session', async () => {
      const proc1 = makeProc(11111);
      const proc2 = makeProc(22222);

      proc1.sendLines([resultLine('first')]);
      proc2.sendLines([resultLine('second')]);

      mockSpawnOnce(proc1); // first send() → proc1
      mockSpawnOnce(proc2); // second send() → proc2

      await manager.getOrCreate('conv-serial', { projectDir: '/tmp/test' });

      // Both calls start concurrently — second must wait for first
      const p1 = collectChunks(manager, 'conv-serial', 'msg1');
      const p2 = collectChunks(manager, 'conv-serial', 'msg2');

      const [chunks1, chunks2] = await Promise.all([p1, p2]);

      // Both should complete successfully
      expect(chunks1.some((c) => c.type === 'done')).toBe(true);
      expect(chunks2.some((c) => c.type === 'done')).toBe(true);
    });

    it('second send() spawn is called after first completes (strictly serialized)', async () => {
      const proc1 = makeProc(11111);
      const proc2 = makeProc(22222);

      proc1.sendLines([resultLine()]);
      proc2.sendLines([resultLine()]);

      mockSpawnOnce(proc1);
      mockSpawnOnce(proc2);

      await manager.getOrCreate('conv-serial-order', { projectDir: '/tmp/test' });

      const p1 = collectChunks(manager, 'conv-serial-order', 'msg1');
      const p2 = collectChunks(manager, 'conv-serial-order', 'msg2');

      await Promise.all([p1, p2]);

      // spawn called exactly twice (once per send() call)
      expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // EventBus listener cleanup
  // =========================================================================

  describe('EventBus listener cleanup', () => {
    it('removes session.output listener after normal completion', async () => {
      const proc = makeProc();
      proc.sendLines([resultLine()]);
      mockSpawnOnce(proc);

      await manager.getOrCreate('conv-cleanup', { projectDir: '/tmp/test' });
      const beforeCount = eventBus.listenerCount('session.output');

      await collectChunks(manager, 'conv-cleanup');

      await tick(100); // allow finally blocks to run
      expect(eventBus.listenerCount('session.output')).toBe(beforeCount);
    });

    it('removes session.done listener after normal completion', async () => {
      const proc = makeProc();
      proc.sendLines([resultLine()]);
      mockSpawnOnce(proc);

      await manager.getOrCreate('conv-cleanup-done', { projectDir: '/tmp/test' });
      const beforeCount = eventBus.listenerCount('session.done');

      await collectChunks(manager, 'conv-cleanup-done');

      await tick(100);
      expect(eventBus.listenerCount('session.done')).toBe(beforeCount);
    });

    it('removes session.error listener after normal completion', async () => {
      const proc = makeProc();
      proc.sendLines([resultLine()]);
      mockSpawnOnce(proc);

      await manager.getOrCreate('conv-cleanup-err', { projectDir: '/tmp/test' });
      const beforeCount = eventBus.listenerCount('session.error');

      await collectChunks(manager, 'conv-cleanup-err');

      await tick(100);
      expect(eventBus.listenerCount('session.error')).toBe(beforeCount);
    });

    it('removes EventBus listeners even when spawn throws (catch path)', async () => {
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      await manager.getOrCreate('conv-cleanup-throw', { projectDir: '/tmp/test' });
      const beforeOutput = eventBus.listenerCount('session.output');
      const beforeDone = eventBus.listenerCount('session.done');
      const beforeError = eventBus.listenerCount('session.error');

      await collectChunks(manager, 'conv-cleanup-throw');
      await tick(100);

      expect(eventBus.listenerCount('session.output')).toBe(beforeOutput);
      expect(eventBus.listenerCount('session.done')).toBe(beforeDone);
      expect(eventBus.listenerCount('session.error')).toBe(beforeError);
    });
  });

  // =========================================================================
  // Bug #14 — resultReceived=false + session on disk → messagesSent bump
  // =========================================================================

  describe('Bug #14 — post-failure disk check', () => {
    it('bumps messagesSent to 1 when session is on disk after failed spawn', async () => {
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      await manager.getOrCreate('conv-bug14', { projectDir: '/tmp/test' });

      // Spy on private sessionExistsOnDisk to simulate session on disk
      vi.spyOn(manager as never, 'sessionExistsOnDisk').mockResolvedValueOnce(true);

      await collectChunks(manager, 'conv-bug14');
      await tick(50);

      // messagesSent should be bumped from 0 → 1 (switch to --resume mode)
      // Access internal session (getSession() returns SessionInfo which doesn't expose messagesSent)
      const session = (manager as any).sessions.get('conv-bug14');
      expect(session?.messagesSent).toBe(1);
    });

    it('does not bump messagesSent when session is NOT on disk after failed spawn', async () => {
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      await manager.getOrCreate('conv-bug14-nodisk', { projectDir: '/tmp/test' });

      vi.spyOn(manager as never, 'sessionExistsOnDisk').mockResolvedValueOnce(false);

      await collectChunks(manager, 'conv-bug14-nodisk');
      await tick(50);

      const session = (manager as any).sessions.get('conv-bug14-nodisk');
      expect(session?.messagesSent).toBe(0);
    });
  });

  // =========================================================================
  // closeInteractive — SIGTERM suppression on natural exit
  // =========================================================================

  describe('closeInteractive — SIGTERM suppression on natural exit', () => {
    it('does NOT call kill(SIGTERM) when process exits naturally within 3s', async () => {
      const proc = makeProc();
      proc.sendLines([resultLine()]); // auto-exits when stdin.end() called
      mockSpawnOnce(proc);

      const killSpy = vi.spyOn(proc, 'kill');

      await manager.getOrCreate('conv-no-sigterm', { projectDir: '/tmp/test' });
      await collectChunks(manager, 'conv-no-sigterm');
      await tick(200); // allow closeInteractive to fully complete

      // Process exited naturally — kill() must NOT have been called
      expect(killSpy).not.toHaveBeenCalled();
    });

    it('DOES call kill(SIGTERM) when process fails to exit within 3s', async () => {
      const proc = makeProc();
      // Push result so send() completes, but do NOT wire auto-exit on stdin close
      proc.stdout.once('resume', () => proc.stdout.push(resultLine() + '\n'));
      mockSpawnOnce(proc);

      const killSpy = vi.spyOn(proc, 'kill');

      await manager.getOrCreate('conv-yes-sigterm', { projectDir: '/tmp/test' });

      vi.useFakeTimers();
      const collectPromise = collectChunks(manager, 'conv-yes-sigterm');
      // Advance past the 3s SIGTERM wait + 2s SIGKILL wait
      await vi.advanceTimersByTimeAsync(6000);
      vi.useRealTimers();
      await collectPromise;
      await tick(100);

      expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    });
  });

  // =========================================================================
  // Circuit breaker integration
  // =========================================================================

  describe('circuit breaker integration', () => {
    it('session circuit breaker opens after 5 spawn failures', async () => {
      // Use unique projectDir to avoid project-level CB interfering with assertions
      // (project CB and session CB have same threshold=5; project CB opens simultaneously)
      await manager.getOrCreate('conv-cb-open', { projectDir: '/tmp/cb-test-isolated' });

      // Trigger 5 failures — CB opens on the 5th recordFailure() inside the catch block
      for (let i = 0; i < 5; i++) {
        vi.mocked(spawn).mockImplementationOnce(() => {
          throw new Error(`failure ${i}`);
        });
        vi.spyOn(manager as never, 'sessionExistsOnDisk').mockResolvedValueOnce(false);
        await collectChunks(manager, 'conv-cb-open', `msg${i}`, '/tmp/cb-test-isolated');
      }

      // Session circuit breaker should now be open
      const sessionInternal = (manager as any).sessions.get('conv-cb-open');
      expect(sessionInternal.circuitBreaker.getState()).toBe('open');
    });
  });
});
