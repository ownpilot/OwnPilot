/**
 * A5: Hard timeout for runViaInteractive() while(!finished) loop.
 * Uses a short ccSpawnTimeoutMs (100ms) and fake timers to avoid 30-min waits.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

vi.mock('../src/process-alive.ts', () => ({
  isProcessAlive: (pid: number | null | undefined) => pid != null,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn() };
});

// Short timeout so tests don't need to advance 30 minutes
vi.mock('../src/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.ts')>();
  return { config: { ...actual.config, ccSpawnTimeoutMs: 100 } };
});

import { spawn } from 'node:child_process';
import { ClaudeManager } from '../src/claude-manager.ts';
import type { StreamChunk } from '../src/types.ts';

function createFakeProcess(pid = 55555) {
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
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = pid;
  proc.killed = false;
  proc.kill = vi.fn(() => { proc.killed = true; });
  return proc;
}

describe('runViaInteractive hard timeout (A5)', () => {
  let manager: ClaudeManager;
  let fakeProc: ReturnType<typeof createFakeProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ClaudeManager();
    fakeProc = createFakeProcess();
    vi.mocked(spawn).mockReturnValue(fakeProc as never);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await manager.shutdownAll();
  });

  it('yields error chunk when CC hangs past ccSpawnTimeoutMs', async () => {
    vi.useFakeTimers();

    const chunks: StreamChunk[] = [];
    const collectTask = (async () => {
      for await (const c of manager.send('conv-ht', 'hang forever')) {
        chunks.push(c);
      }
    })();

    // Let generator initialize (startInteractive + writeToSession + enter while loop)
    await vi.advanceTimersByTimeAsync(1);

    // Fire the 100ms hard timeout → finished=true, wake() called, error chunk queued
    await vi.advanceTimersByTimeAsync(100);

    // Generator resumes, exits while loop, enters finally → calls closeInteractive.
    // closeInteractive awaits Promise.race([exitPromise, setTimeout(3000)]).
    // Advance past closeInteractive's 3s initial wait + 2s SIGKILL escalation window.
    // fakeProc.kill sets killed=true on SIGTERM, so SIGKILL is skipped, but the
    // Promise.race([sigkillExit, sigkillWait]) still waits the full 2s.
    await vi.advanceTimersByTimeAsync(3001);
    await vi.advanceTimersByTimeAsync(2001);

    await collectTask;

    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect((errorChunk as { type: 'error'; error: string }).error).toContain('timed out');
  });

  it('does not yield timeout error when result arrives before deadline', async () => {
    // Real timers: config sets 100ms timeout, result arrives at ~10ms (well before deadline)
    const chunks: StreamChunk[] = [];
    const collectTask = (async () => {
      for await (const c of manager.send('conv-ht-ok', 'quick task')) {
        chunks.push(c);
      }
    })();

    // Let the generator initialize and enter the while loop
    await new Promise((r) => setTimeout(r, 10));

    // Write result via stdout (triggers processInteractiveOutput → session.done → onDone)
    fakeProc.stdout.write(
      JSON.stringify({ type: 'result', result: 'done', usage: { input_tokens: 10, output_tokens: 5 } }) + '\n',
    );
    // Emit exit so closeInteractive resolves in the finally block
    fakeProc.emit('exit', 0, null);

    await collectTask;

    // No timeout error — result arrived in time
    const errorChunk = chunks.find((c) => c.type === 'error' && (c as any).error?.includes('timed out'));
    expect(errorChunk).toBeUndefined();
  });
});
