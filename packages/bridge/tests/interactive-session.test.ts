import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// Mock isProcessAlive so fake test PIDs are treated as alive
vi.mock('../src/process-alive.ts', () => ({
  isProcessAlive: (pid: number | null | undefined) => pid != null,
}));

// Mock child_process.spawn BEFORE importing ClaudeManager
vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn() };
});

import { spawn } from 'node:child_process';
import { ClaudeManager } from '../src/claude-manager.ts';
import { eventBus } from '../src/event-bus.ts';

// ---------------------------------------------------------------------------
// Fake ChildProcess helper
// ---------------------------------------------------------------------------

function createFakeProcess(pid = 12345) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const stdin = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    writable: boolean;
  };
  stdin.write = vi.fn(() => true);
  stdin.end = vi.fn();
  stdin.writable = true;

  const proc = new EventEmitter() as EventEmitter & {
    stdin: typeof stdin;
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.pid = pid;
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
  });
  return proc;
}

// Helper: write a JSON line to fake stdout (simulates CC output)
function writeLine(proc: ReturnType<typeof createFakeProcess>, obj: Record<string, unknown>) {
  proc.stdout.write(JSON.stringify(obj) + '\n');
}

// Helper: wait for event bus to process (readline is async)
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Interactive Session Mode (Phase 4b)', () => {
  let manager: ClaudeManager;
  let fakeProc: ReturnType<typeof createFakeProcess>;

  beforeEach(async () => {
    vi.clearAllMocks();
    manager = new ClaudeManager();
    fakeProc = createFakeProcess();
    vi.mocked(spawn).mockReturnValue(fakeProc as never);
    eventBus.removeAllListeners();
  });

  afterEach(async () => {
    await manager.shutdownAll();
    vi.restoreAllMocks();
    eventBus.removeAllListeners();
  });

  // =========================================================================
  // startInteractive
  // =========================================================================

  describe('startInteractive', () => {
    it('spawns CC and returns session info', async () => {
      const result = await manager.startInteractive('conv-1', { projectDir: '/tmp/test' });
      expect(result.conversationId).toBe('conv-1');
      expect(result.sessionId).toBeDefined();
      expect(result.pid).toBe(12345);
      expect(vi.mocked(spawn)).toHaveBeenCalledOnce();
    });

    it('marks session as interactive', async () => {
      await manager.startInteractive('conv-2');
      expect(manager.isInteractive('conv-2')).toBe(true);
    });

    it('includes interactive sessions in getInteractiveSessions()', async () => {
      await manager.startInteractive('conv-3');
      const sessions = manager.getInteractiveSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].conversationId).toBe('conv-3');
      expect(sessions[0].pid).toBe(12345);
    });

    it('spawns CC with --input-format stream-json and --output-format stream-json', async () => {
      await manager.startInteractive('conv-args');
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      expect(args).toContain('--input-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--output-format');
      expect(args).toContain('--print');
      expect(args).toContain('--verbose');
    });

    it('passes --max-turns from options', async () => {
      await manager.startInteractive('conv-mt', { maxTurns: 5 });
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const maxTurnsIdx = args.indexOf('--max-turns');
      expect(maxTurnsIdx).toBeGreaterThan(-1);
      expect(args[maxTurnsIdx + 1]).toBe('5');
    });

    it('defaults --max-turns to 50', async () => {
      await manager.startInteractive('conv-mt-default');
      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      const maxTurnsIdx = args.indexOf('--max-turns');
      expect(args[maxTurnsIdx + 1]).toBe('50');
    });

    // ---- configOverrides ----

    it('applies model override from configOverrides', async () => {
      await manager.getOrCreate('conv-co-model');
      manager.setConfigOverrides('conv-co-model', { model: 'claude-opus-4-6' });
      await manager.startInteractive('conv-co-model');
      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      const modelIdx = args.indexOf('--model');
      expect(args[modelIdx + 1]).toBe('claude-opus-4-6');
    });

    it('applies effort override from configOverrides', async () => {
      await manager.getOrCreate('conv-co-effort');
      manager.setConfigOverrides('conv-co-effort', { effort: 'min' });
      await manager.startInteractive('conv-co-effort');
      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(args).toContain('--effort');
      expect(args[args.indexOf('--effort') + 1]).toBe('min');
    });

    it('applies additionalDirs from configOverrides', async () => {
      await manager.getOrCreate('conv-co-dirs');
      manager.setConfigOverrides('conv-co-dirs', { additionalDirs: ['/extra/dir'] });
      await manager.startInteractive('conv-co-dirs');
      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      // Find the --add-dir that matches the extra dir (not the project dir)
      const addDirIdxs = args.reduce<number[]>((acc, a, i) => (a === '--add-dir' ? [...acc, i] : acc), []);
      expect(addDirIdxs.some((i) => args[i + 1] === '/extra/dir')).toBe(true);
    });

    it('applies permissionMode from configOverrides', async () => {
      await manager.getOrCreate('conv-co-perm');
      manager.setConfigOverrides('conv-co-perm', { permissionMode: 'bypassPermissions' });
      await manager.startInteractive('conv-co-perm');
      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(args).toContain('--permission-mode');
      expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    });

    // ---- Guards ----

    it('throws if session already has interactive process', async () => {
      await manager.startInteractive('conv-dup');
      await expect(manager.startInteractive('conv-dup'))
        .rejects.toThrow(/already has an interactive process/);
    });

    it('cleans up zombie and starts new interactive process', async () => {
      await manager.startInteractive('conv-zombie-restart');
      // Simulate: process died externally without .kill() being called
      fakeProc.pid = null as any; // isProcessAlive(null) === false (zombie)
      // Before fix: throws "already has an interactive process"
      // After fix: cleans up zombie, spawns fresh process
      const fp2 = createFakeProcess(99999);
      // Use mockReturnValue (not Once) — if the test fails (RED state), spawn is
      // never called, so mockReturnValueOnce would orphan in the queue and pollute
      // subsequent tests. mockReturnValue is overridden by beforeEach cleanly.
      vi.mocked(spawn).mockReturnValue(fp2 as never);
      const result = await manager.startInteractive('conv-zombie-restart');
      expect(result.pid).toBe(99999);
    });

    it('throws when startInteractive is already in progress (TOCTOU guard)', async () => {
      await manager.getOrCreate('conv-b1-starting');
      // Simulate: another concurrent call has set the flag and is between guard and spawn
      const session = (manager as any).sessions.get('conv-b1-starting');
      session.interactiveStarting = true;
      await expect(manager.startInteractive('conv-b1-starting'))
        .rejects.toThrow(/already starting/i);
    });

    it('clears interactiveStarting on spawn failure (no flag leak)', async () => {
      await manager.getOrCreate('conv-b1-fail');
      vi.mocked(spawn).mockImplementationOnce(() => { throw new Error('spawn ENOENT'); });
      await expect(manager.startInteractive('conv-b1-fail'))
        .rejects.toThrow(/spawn ENOENT/);
      // Flag must be cleared so the session is not permanently locked
      const session = (manager as any).sessions.get('conv-b1-fail');
      expect(session.interactiveStarting).toBe(false);
    });

    it('throws if session has active spawn-per-message process', async () => {
      // Create session and fake an activeProcess
      await manager.getOrCreate('conv-active');
      // Access private field — necessary for testing guard
      const session = (manager as any).sessions.get('conv-active');
      session.activeProcess = createFakeProcess(9999);

      await expect(manager.startInteractive('conv-active'))
        .rejects.toThrow(/active spawn-per-message process/);
    });

    it('throws if session is paused', async () => {
      await manager.getOrCreate('conv-paused');
      manager.pause('conv-paused', 'manual takeover');
      await expect(manager.startInteractive('conv-paused'))
        .rejects.toThrow(/paused/);
    });

    it('throws when concurrent interactive limit (10) reached', async () => {
      for (let i = 0; i < 10; i++) {
        const fp = createFakeProcess(1000 + i);
        vi.mocked(spawn).mockReturnValueOnce(fp as never);
        await manager.startInteractive(`conv-limit-${i}`, { projectDir: '/tmp/test' });
      }
      await expect(manager.startInteractive('conv-overflow'))
        .rejects.toThrow(/Too many interactive sessions/);
    });

    it('allows new interactive after one is closed (under limit)', async () => {
      for (let i = 0; i < 3; i++) {
        const fp = createFakeProcess(2000 + i);
        vi.mocked(spawn).mockReturnValueOnce(fp as never);
        await manager.startInteractive(`conv-cycle-${i}`, { projectDir: '/tmp/test' });
      }

      // Close one
      const fp0 = (manager as any).sessions.get('conv-cycle-0');
      fp0.interactiveProcess.emit('exit', 0, null);
      await tick();

      // Now should be able to start a new one
      const fp3 = createFakeProcess(3000);
      vi.mocked(spawn).mockReturnValueOnce(fp3 as never);
      const result = await manager.startInteractive('conv-cycle-3', { projectDir: '/tmp/test' });
      expect(result.pid).toBe(3000);
    });
  });

  // =========================================================================
  // writeToSession
  // =========================================================================

  describe('writeToSession', () => {
    it('writes stream-json message to interactive stdin', async () => {
      await manager.startInteractive('conv-w1');
      const ok = manager.writeToSession('conv-w1', 'Hello world');
      expect(ok).toBe(true);
      expect(fakeProc.stdin.write).toHaveBeenCalledOnce();

      const rawArg = fakeProc.stdin.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(rawArg.trim());
      expect(parsed.type).toBe('user');
      expect(parsed.message.role).toBe('user');
      expect(parsed.message.content).toBe('Hello world');
    });

    it('appends newline after JSON', async () => {
      await manager.startInteractive('conv-w-nl');
      manager.writeToSession('conv-w-nl', 'test');
      const rawArg = fakeProc.stdin.write.mock.calls[0][0] as string;
      expect(rawArg.endsWith('\n')).toBe(true);
    });

    it('returns false for non-existent session', () => {
      expect(manager.writeToSession('nonexistent', 'Hi')).toBe(false);
    });

    it('returns false for non-interactive session', async () => {
      await manager.getOrCreate('conv-w-nonint');
      expect(manager.writeToSession('conv-w-nonint', 'Hi')).toBe(false);
    });

    it('returns false if interactive process is killed', async () => {
      await manager.startInteractive('conv-w-killed');
      fakeProc.kill(); // sets killed=true
      fakeProc.pid = null as any; // isProcessAlive(null) === false
      expect(manager.writeToSession('conv-w-killed', 'Hi')).toBe(false);
    });

    it('returns false if stdin is not writable', async () => {
      await manager.startInteractive('conv-w-nonwritable');
      fakeProc.stdin.writable = false;
      expect(manager.writeToSession('conv-w-nonwritable', 'Hi')).toBe(false);
    });

    it('returns false for zombie process (killed=false but not alive)', async () => {
      await manager.startInteractive('conv-w-zombie');
      // Simulate: process died externally (OOM/SIGKILL), .kill() was never called
      fakeProc.pid = null as any; // isProcessAlive(null) === false in mock
      // fakeProc.killed stays false — this is the zombie scenario
      expect(manager.writeToSession('conv-w-zombie', 'Hi')).toBe(false);
    });

    it('clears pendingApproval on write', async () => {
      await manager.startInteractive('conv-w-pending');
      manager.setPendingApproval('conv-w-pending', 'QUESTION', 'Which DB?');
      expect(manager.getSession('conv-w-pending')?.pendingApproval).not.toBeNull();

      manager.writeToSession('conv-w-pending', 'PostgreSQL');
      expect(manager.getSession('conv-w-pending')?.pendingApproval).toBeNull();
    });

    it('updates lastActivity timestamp', async () => {
      await manager.startInteractive('conv-w-time');
      const before = manager.getSession('conv-w-time')!.lastActivity;
      await tick(10);
      manager.writeToSession('conv-w-time', 'ping');
      const after = manager.getSession('conv-w-time')!.lastActivity;
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  // =========================================================================
  // closeInteractive
  // =========================================================================

  describe('closeInteractive', () => {
    it('ends stdin and cleans up on graceful exit', async () => {
      await manager.startInteractive('conv-c1');
      // Simulate process exiting after stdin.end()
      setTimeout(() => fakeProc.emit('exit', 0, null), 50);
      const closed = await manager.closeInteractive('conv-c1');
      expect(closed).toBe(true);
      expect(fakeProc.stdin.end).toHaveBeenCalled();
      expect(manager.isInteractive('conv-c1')).toBe(false);
    });

    it('returns false for non-existent session', async () => {
      expect(await manager.closeInteractive('nonexistent')).toBe(false);
    });

    it('returns false for non-interactive session', async () => {
      await manager.getOrCreate('conv-c-nonint');
      expect(await manager.closeInteractive('conv-c-nonint')).toBe(false);
    });

    it('sends SIGTERM after 3s timeout if process does not exit', async () => {
      await manager.startInteractive('conv-c-timeout');
      // Don't emit exit — let the 3s timeout + 2s SIGKILL window trigger
      const closed = await manager.closeInteractive('conv-c-timeout');
      expect(closed).toBe(true);
      expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
    }, 6000);

    it('escalates to SIGKILL 2s after SIGTERM if process ignores SIGTERM (B3)', async () => {
      vi.useFakeTimers();
      try {
        await manager.startInteractive('conv-c-sigkill');
        // Override: SIGTERM is ignored (killed stays false), SIGKILL actually kills
        fakeProc.kill = vi.fn((signal?: string) => {
          if (signal === 'SIGKILL') fakeProc.killed = true;
        });

        const closeTask = manager.closeInteractive('conv-c-sigkill');

        // Advance past 3s timeout → SIGTERM sent
        await vi.advanceTimersByTimeAsync(3001);
        expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
        expect(fakeProc.kill).not.toHaveBeenCalledWith('SIGKILL');

        // Advance past 2s SIGKILL escalation wait
        await vi.advanceTimersByTimeAsync(2001);
        expect(fakeProc.kill).toHaveBeenCalledWith('SIGKILL');

        await closeTask;
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not SIGKILL if process exits after SIGTERM (B3)', async () => {
      vi.useFakeTimers();
      try {
        await manager.startInteractive('conv-c-sigkill-skip');
        // kill('SIGTERM') sets killed=true (normal mock behavior) — no SIGKILL needed
        const closeTask = manager.closeInteractive('conv-c-sigkill-skip');

        await vi.advanceTimersByTimeAsync(3001); // SIGTERM sent, killed=true
        await vi.advanceTimersByTimeAsync(2001); // SIGKILL window passes

        await closeTask;
        // kill called exactly once (SIGTERM), SIGKILL not sent
        expect(fakeProc.kill).toHaveBeenCalledTimes(1);
        expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
        expect(fakeProc.kill).not.toHaveBeenCalledWith('SIGKILL');
      } finally {
        vi.useRealTimers();
      }
    });

    it('cleans up interactive state after close', async () => {
      await manager.startInteractive('conv-c-state');
      setTimeout(() => fakeProc.emit('exit', 0, null), 50);
      await manager.closeInteractive('conv-c-state');

      // Session still exists (not terminated), but no longer interactive
      expect(manager.getSession('conv-c-state')).not.toBeNull();
      expect(manager.isInteractive('conv-c-state')).toBe(false);
      expect(manager.getInteractiveSessions()).toHaveLength(0);
    });
  });

  // =========================================================================
  // isInteractive
  // =========================================================================

  describe('isInteractive', () => {
    it('returns false for non-existent session', () => {
      expect(manager.isInteractive('nope')).toBe(false);
    });

    it('returns true for active interactive session', async () => {
      await manager.startInteractive('conv-i1');
      expect(manager.isInteractive('conv-i1')).toBe(true);
    });

    it('returns false after process is killed', async () => {
      await manager.startInteractive('conv-i2');
      fakeProc.kill(); // sets killed=true
      fakeProc.pid = null as any; // isProcessAlive(null) === false
      expect(manager.isInteractive('conv-i2')).toBe(false);
    });

    it('returns false for zombie process (killed=false but not alive)', async () => {
      await manager.startInteractive('conv-i-zombie');
      fakeProc.pid = null as any; // isProcessAlive(null) === false
      expect(manager.isInteractive('conv-i-zombie')).toBe(false);
    });

    it('returns false after closeInteractive', async () => {
      await manager.startInteractive('conv-i3');
      setTimeout(() => fakeProc.emit('exit', 0, null), 50);
      await manager.closeInteractive('conv-i3');
      expect(manager.isInteractive('conv-i3')).toBe(false);
    });
  });

  // =========================================================================
  // getInteractiveSessions
  // =========================================================================

  describe('getInteractiveSessions', () => {
    it('returns empty array when no interactive sessions', () => {
      expect(manager.getInteractiveSessions()).toEqual([]);
    });

    it('returns empty when sessions exist but none interactive', async () => {
      await manager.getOrCreate('conv-g-none1');
      await manager.getOrCreate('conv-g-none2');
      expect(manager.getInteractiveSessions()).toEqual([]);
    });

    it('returns only interactive sessions', async () => {
      await manager.getOrCreate('conv-g-regular');
      const fp = createFakeProcess(8888);
      vi.mocked(spawn).mockReturnValueOnce(fp as never);
      await manager.startInteractive('conv-g-interactive', { projectDir: '/tmp/test' });

      const sessions = manager.getInteractiveSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].conversationId).toBe('conv-g-interactive');
      expect(sessions[0].pid).toBe(8888);
    });

    it('excludes killed interactive processes', async () => {
      await manager.startInteractive('conv-g-killed');
      fakeProc.kill(); // sets killed=true
      fakeProc.pid = null as any; // isProcessAlive(null) === false
      expect(manager.getInteractiveSessions()).toHaveLength(0);
    });

    it('excludes zombie interactive processes (killed=false but not alive)', async () => {
      await manager.startInteractive('conv-g-zombie');
      fakeProc.pid = null as any; // isProcessAlive(null) === false
      expect(manager.getInteractiveSessions()).toHaveLength(0);
    });
  });

  // =========================================================================
  // send() guard — interactive process blocks spawn-per-message
  // =========================================================================

  describe('send() guard when interactive process active', () => {
    it('yields error when session has interactive process', async () => {
      await manager.startInteractive('conv-s1');

      const chunks: Array<{ type: string; error?: string }> = [];
      for await (const chunk of manager.send('conv-s1', 'test')) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('error');
      expect(chunks[0].error).toContain('active interactive process');
    });
  });

  // =========================================================================
  // terminate() includes interactive cleanup
  // =========================================================================

  describe('terminate() cleans up interactive', () => {
    it('terminates interactive session and removes it', async () => {
      await manager.startInteractive('conv-t1');
      expect(manager.isInteractive('conv-t1')).toBe(true);
      manager.terminate('conv-t1');
      expect(manager.isInteractive('conv-t1')).toBe(false);
      expect(manager.getSession('conv-t1')).toBeNull();
    });

    it('kills interactive process on terminate', async () => {
      await manager.startInteractive('conv-t2');
      manager.terminate('conv-t2');
      expect(fakeProc.kill).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // processInteractiveOutput — EventBus emissions
  // =========================================================================

  describe('processInteractiveOutput (stdout → EventBus)', () => {
    it('emits session.output for content_block_delta text', async () => {
      const received: Array<{ text: string; conversationId: string }> = [];
      eventBus.on('session.output', (e) => received.push(e as never));

      await manager.startInteractive('conv-po1');
      writeLine(fakeProc, {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello world' },
      });
      await tick();

      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('Hello world');
      expect(received[0].conversationId).toBe('conv-po1');
    });

    it('emits multiple session.output for multiple deltas', async () => {
      const received: Array<{ text: string }> = [];
      eventBus.on('session.output', (e) => received.push(e as never));

      await manager.startInteractive('conv-po-multi');
      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk1' } });
      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk2' } });
      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk3' } });
      await tick();

      expect(received).toHaveLength(3);
      expect(received.map((r) => r.text)).toEqual(['chunk1', 'chunk2', 'chunk3']);
    });

    it('emits session.done on result event with usage', async () => {
      const doneEvents: Array<{ usage?: { input_tokens: number; output_tokens: number } }> = [];
      eventBus.on('session.done', (e) => doneEvents.push(e as never));

      await manager.startInteractive('conv-po-done');
      writeLine(fakeProc, {
        type: 'result',
        result: 'Done processing.',
        usage: { input_tokens: 200, output_tokens: 80 },
      });
      await tick();

      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].usage).toEqual({ input_tokens: 200, output_tokens: 80 });
    });

    it('emits session.done without usage when not provided', async () => {
      const doneEvents: Array<{ usage?: unknown }> = [];
      eventBus.on('session.done', (e) => doneEvents.push(e as never));

      await manager.startInteractive('conv-po-no-usage');
      writeLine(fakeProc, { type: 'result', result: 'OK' });
      await tick();

      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].usage).toBeUndefined();
    });

    it('emits session.error on result with subtype error', async () => {
      const errorEvents: Array<{ error: string }> = [];
      eventBus.on('session.error', (e) => errorEvents.push(e as never));

      await manager.startInteractive('conv-po-err');
      writeLine(fakeProc, {
        type: 'result',
        subtype: 'error',
        result: 'Something went wrong',
      });
      await tick();

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].error).toContain('Something went wrong');
    });

    it('emits session.output from result.result when no content_block_deltas', async () => {
      const outputEvents: Array<{ text: string }> = [];
      eventBus.on('session.output', (e) => outputEvents.push(e as never));

      await manager.startInteractive('conv-po-result-text');
      // No content_block_delta, just a result with text
      writeLine(fakeProc, {
        type: 'result',
        result: 'Final answer here',
        usage: { input_tokens: 50, output_tokens: 20 },
      });
      await tick();

      expect(outputEvents).toHaveLength(1);
      expect(outputEvents[0].text).toBe('Final answer here');
    });

    it('does NOT emit session.output from result.result when content_block_deltas existed', async () => {
      const outputEvents: Array<{ text: string }> = [];
      eventBus.on('session.output', (e) => outputEvents.push(e as never));

      await manager.startInteractive('conv-po-no-dup');
      // First: content_block_delta
      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'streamed' } });
      // Then: result with same text
      writeLine(fakeProc, { type: 'result', result: 'streamed', usage: { input_tokens: 10, output_tokens: 5 } });
      await tick();

      // Should only have 1 output from the delta, not 2
      expect(outputEvents).toHaveLength(1);
      expect(outputEvents[0].text).toBe('streamed');
    });

    it('ignores non-JSON lines', async () => {
      const outputEvents: Array<{ text: string }> = [];
      eventBus.on('session.output', (e) => outputEvents.push(e as never));

      await manager.startInteractive('conv-po-nonjson');
      fakeProc.stdout.write('this is not JSON\n');
      fakeProc.stdout.write('\n');
      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'valid' } });
      await tick();

      expect(outputEvents).toHaveLength(1);
      expect(outputEvents[0].text).toBe('valid');
    });

    it('ignores unknown event types', async () => {
      const outputEvents: Array<{ text: string }> = [];
      eventBus.on('session.output', (e) => outputEvents.push(e as never));

      await manager.startInteractive('conv-po-unknown');
      writeLine(fakeProc, { type: 'system', data: {} });
      writeLine(fakeProc, { type: 'message_start' });
      writeLine(fakeProc, { type: 'content_block_start' });
      writeLine(fakeProc, { type: 'totally_made_up', foo: 'bar' });
      await tick();

      expect(outputEvents).toHaveLength(0);
    });

    it('does not count tokens from message_delta (only result events)', async () => {
      await manager.startInteractive('conv-po-tokens');
      writeLine(fakeProc, { type: 'message_delta', usage: { input_tokens: 100, output_tokens: 50 } });
      await tick();

      const session = manager.getSession('conv-po-tokens');
      // message_delta usage is ignored — only 'result' events count tokens
      expect(session!.tokensUsed).toBe(0);
    });

    it('tracks token usage from result event (no double-count with message_delta)', async () => {
      await manager.startInteractive('conv-po-accum');
      writeLine(fakeProc, { type: 'message_delta', usage: { input_tokens: 100, output_tokens: 50 } });
      writeLine(fakeProc, { type: 'result', result: 'OK', usage: { input_tokens: 200, output_tokens: 80 } });
      await tick();

      const session = manager.getSession('conv-po-accum');
      // Only result counts: 200+80 = 280 (message_delta 150 is NOT added again)
      expect(session!.tokensUsed).toBe(280);
    });

    // ---- Pattern detection in interactive output ----

    it('emits session.phase_complete when PHASE_COMPLETE pattern detected', async () => {
      const phaseEvents: Array<{ pattern: string; text: string }> = [];
      eventBus.on('session.phase_complete', (e) => phaseEvents.push(e as never));

      await manager.startInteractive('conv-po-phase');
      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Phase 3 complete - all tests passing' } });
      writeLine(fakeProc, { type: 'result', result: '' });
      await tick();

      expect(phaseEvents).toHaveLength(1);
      expect(phaseEvents[0].pattern).toBe('PHASE_COMPLETE');
    });

    it('emits session.blocking and sets pendingApproval for QUESTION pattern', async () => {
      const blockingEvents: Array<{ pattern: string; text: string; respondUrl: string }> = [];
      eventBus.on('session.blocking', (e) => blockingEvents.push(e as never));

      await manager.startInteractive('conv-po-question');
      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'QUESTION: Which database should I use?' } });
      writeLine(fakeProc, { type: 'result', result: '' });
      await tick();

      expect(blockingEvents).toHaveLength(1);
      expect(blockingEvents[0].pattern).toBe('QUESTION');
      expect(blockingEvents[0].respondUrl).toContain('/input');

      const session = manager.getSession('conv-po-question');
      expect(session?.pendingApproval?.pattern).toBe('QUESTION');
    });

    it('emits session.blocking for TASK_BLOCKED pattern', async () => {
      const blockingEvents: Array<{ pattern: string }> = [];
      eventBus.on('session.blocking', (e) => blockingEvents.push(e as never));

      await manager.startInteractive('conv-po-blocked');
      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'TASK_BLOCKED: Missing API credentials' } });
      writeLine(fakeProc, { type: 'result', result: '' });
      await tick();

      expect(blockingEvents).toHaveLength(1);
      expect(blockingEvents[0].pattern).toBe('TASK_BLOCKED');

      const session = manager.getSession('conv-po-blocked');
      expect(session?.pendingApproval?.pattern).toBe('TASK_BLOCKED');
    });

    it('resets turn text between result events (multi-turn)', async () => {
      const outputEvents: Array<{ text: string }> = [];
      eventBus.on('session.output', (e) => outputEvents.push(e as never));
      const doneEvents: Array<unknown> = [];
      eventBus.on('session.done', (e) => doneEvents.push(e));

      await manager.startInteractive('conv-po-multiturn');

      // Turn 1
      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Turn 1 output' } });
      writeLine(fakeProc, { type: 'result', result: '', usage: { input_tokens: 10, output_tokens: 5 } });

      // Turn 2 (second message written by user)
      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Turn 2 output' } });
      writeLine(fakeProc, { type: 'result', result: '', usage: { input_tokens: 20, output_tokens: 10 } });

      await tick();

      expect(outputEvents).toHaveLength(2);
      expect(doneEvents).toHaveLength(2);
    });
  });

  // =========================================================================
  // Process lifecycle events
  // =========================================================================

  describe('process lifecycle events', () => {
    it('does not emit session.done on clean process exit (owned by result event)', async () => {
      // session.done is emitted by processInteractiveOutput when a 'result' event
      // arrives. The exit handler must NOT also emit it — that would double-fire.
      const doneEvents: Array<unknown> = [];
      eventBus.on('session.done', (e) => doneEvents.push(e));

      await manager.startInteractive('conv-exit1');
      fakeProc.emit('exit', 0, null);
      await tick();

      expect(doneEvents).toHaveLength(0);
    });

    it('emits session.error on abnormal process exit (non-zero code)', async () => {
      const errorEvents: Array<{ error: string; conversationId: string }> = [];
      eventBus.on('session.error', (e) => errorEvents.push(e as never));

      await manager.startInteractive('conv-exit-abnormal');
      fakeProc.emit('exit', 1, null);
      await tick();

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].conversationId).toBe('conv-exit-abnormal');
      expect(errorEvents[0].error).toContain('code=1');
    });

    it('does not emit session.error on clean process exit (code=0)', async () => {
      const errorEvents: Array<unknown> = [];
      eventBus.on('session.error', (e) => errorEvents.push(e));

      await manager.startInteractive('conv-exit-clean');
      fakeProc.emit('exit', 0, null);
      await tick();

      expect(errorEvents).toHaveLength(0);
    });

    it('cleans up interactive state on process exit', async () => {
      await manager.startInteractive('conv-exit2');
      expect(manager.isInteractive('conv-exit2')).toBe(true);
      fakeProc.emit('exit', 0, null);
      await tick();
      expect(manager.isInteractive('conv-exit2')).toBe(false);
    });

    it('emits session.error on spawn error', async () => {
      const errorEvents: Array<{ error: string }> = [];
      eventBus.on('session.error', (e) => errorEvents.push(e as never));

      await manager.startInteractive('conv-spawn-err');
      fakeProc.emit('error', new Error('ENOENT: claude not found'));
      await tick();

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].error).toContain('ENOENT');
    });

    it('cleans up on spawn error', async () => {
      await manager.startInteractive('conv-spawn-err2');
      fakeProc.emit('error', new Error('EPERM'));
      await tick();
      expect(manager.isInteractive('conv-spawn-err2')).toBe(false);
    });

    it('does not crash when stdin emits EPIPE (CC exits normally)', async () => {
      await manager.startInteractive('conv-stdin-epipe');
      const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
      // Without the stdin error handler, emitting 'error' on an EventEmitter
      // with no listener throws — crashing the bridge process.
      expect(() => fakeProc.stdin.emit('error', epipe)).not.toThrow();
    });

    it('does not crash when stdin emits unexpected error', async () => {
      await manager.startInteractive('conv-stdin-eio');
      const eio = Object.assign(new Error('write EIO'), { code: 'EIO' });
      expect(() => fakeProc.stdin.emit('error', eio)).not.toThrow();
    });
  });

  // =========================================================================
  // Idle timeout
  // =========================================================================

  describe('interactive idle timeout', () => {
    it('sets idle timer on startInteractive', async () => {
      await manager.startInteractive('conv-idle1');
      const session = (manager as any).sessions.get('conv-idle1');
      expect(session.interactiveIdleTimer).not.toBeNull();
    });

    it('resets idle timer on writeToSession', async () => {
      await manager.startInteractive('conv-idle2');
      const session = (manager as any).sessions.get('conv-idle2');
      const firstTimer = session.interactiveIdleTimer;
      await tick(10);
      manager.writeToSession('conv-idle2', 'ping');
      const secondTimer = session.interactiveIdleTimer;
      // Timer reference should change (old cleared, new set)
      expect(secondTimer).not.toBe(firstTimer);
    });

    it('clears idle timer on closeInteractive', async () => {
      await manager.startInteractive('conv-idle3');
      setTimeout(() => fakeProc.emit('exit', 0, null), 50);
      await manager.closeInteractive('conv-idle3');
      const session = (manager as any).sessions.get('conv-idle3');
      expect(session.interactiveIdleTimer).toBeNull();
    });

    it('clears idle timer on terminate', async () => {
      await manager.startInteractive('conv-idle4');
      manager.terminate('conv-idle4');
      // Session is gone, so no timer leak
      expect((manager as any).sessions.get('conv-idle4')).toBeUndefined();
    });

    it('resets idle timer on CC output (content_block_delta)', async () => {
      // B2: idle timer must reset when CC produces output, not just when we write to it.
      // Without this fix, a CC running a long task (>5 min) would be killed by the idle timer
      // even though it's actively generating output.
      await manager.startInteractive('conv-idle-output');
      const session = (manager as any).sessions.get('conv-idle-output');
      const timerBefore = session.interactiveIdleTimer;

      writeLine(fakeProc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } });
      await tick();

      expect(session.interactiveIdleTimer).not.toBe(timerBefore);
    });

    it('resets idle timer on CC result event', async () => {
      await manager.startInteractive('conv-idle-result');
      const session = (manager as any).sessions.get('conv-idle-result');
      const timerBefore = session.interactiveIdleTimer;

      writeLine(fakeProc, { type: 'result', result: 'done', usage: { input_tokens: 10, output_tokens: 5 } });
      await tick();

      expect(session.interactiveIdleTimer).not.toBe(timerBefore);
    });
  });
});
