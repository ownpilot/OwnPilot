/**
 * Claude Manager spawn lifecycle tests.
 *
 * These tests use a mocked child_process.spawn to control CC process
 * behavior without launching real processes. The fake process (FakeProc)
 * emits events and accepts stdin writes just like a real ChildProcess.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// ---------------------------------------------------------------------------
// Mock child_process BEFORE importing ClaudeManager so the module picks up
// our mock when it does `import { spawn } from 'node:child_process'`.
// ---------------------------------------------------------------------------

vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn() };
});

// Fake PIDs in FakeProc are not real OS PIDs — mock isProcessAlive so that
// any non-null pid is treated as alive (consistent with interactive-session tests).
vi.mock('../src/process-alive.ts', () => ({
  isProcessAlive: (pid: number | null | undefined) => pid != null,
}));

import { spawn } from 'node:child_process';
import { ClaudeManager } from '../src/claude-manager.ts';

// ---------------------------------------------------------------------------
// FakeProc: minimal ChildProcess mock
// ---------------------------------------------------------------------------

class FakeProc extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  pid = 99999;
  killed = false;
  exitCode: number | null = null;

  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    // Prevent unhandled error events from crashing the test process
    this.stdin.on('error', () => {});
    this.stdout.on('error', () => {});
    this.stderr.on('error', () => {});
  }

  /**
   * Queue NDJSON lines to be pushed to stdout once readline starts consuming
   * (i.e., once stdout.resume() is called). This avoids race conditions where
   * data is pushed before the readline interface has attached to the stream.
   *
   * Exit is emitted with a small delay (50ms) AFTER stdout EOF so that
   * runClaude's finally block can register proc.once('exit', ...) before
   * the event fires. Without this, the 3000ms fallback timeout fires.
   */
  sendLines(lines: string[], exitCode = 0): void {
    const doSend = () => {
      for (const line of lines) {
        this.stdout.push(line + '\n');
      }
      // EOF closes readline, which ends the for-await loop in runClaude
      setImmediate(() => {
        this.stdout.push(null);
        // Exit fires after finally block registers proc.once('exit', ...)
        setTimeout(() => {
          this.exitCode = exitCode;
          this.emit('exit', exitCode, null);
        }, 50);
      });
    };

    // readline calls stdout.resume() when it starts consuming.
    // Listen for that event so we push data only when readline is ready.
    this.stdout.once('resume', doSend);
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.emit('exit', null, signal ?? 'SIGTERM');
    return true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeProc(): FakeProc {
  return new FakeProc();
}

function setupSpawnMock(proc: FakeProc): void {
  (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(proc as unknown as ReturnType<typeof spawn>);
}

/** Collect all chunks from send() into an array. */
async function collectChunks(
  manager: ClaudeManager,
  conversationId: string,
  message: string,
  projectDir = '/tmp/test-project',
) {
  const chunks = [];
  for await (const chunk of manager.send(conversationId, message, projectDir)) {
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeManager — spawn lifecycle', () => {
  let manager: ClaudeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ClaudeManager();
  });

  // -------------------------------------------------------------------------
  // Session management (no spawn needed)
  // -------------------------------------------------------------------------

  it('getOrCreate creates a new session', async () => {
    const info = await manager.getOrCreate('conv-new-1', { projectDir: '/tmp/test' });
    expect(info.conversationId).toBe('conv-new-1');
    expect(info.projectDir).toBe('/tmp/test');
    expect(info.processAlive).toBe(false);
  });

  it('getOrCreate returns same session on second call', async () => {
    const info1 = await manager.getOrCreate('conv-same', { projectDir: '/tmp/test' });
    const info2 = await manager.getOrCreate('conv-same', { projectDir: '/tmp/test' });
    expect(info1.sessionId).toBe(info2.sessionId);
  });

  it('getSession returns null for unknown conversationId', () => {
    expect(manager.getSession('does-not-exist')).toBeNull();
  });

  it('getSession returns session info after getOrCreate', async () => {
    await manager.getOrCreate('conv-get', { projectDir: '/tmp/test' });
    const info = manager.getSession('conv-get');
    expect(info).not.toBeNull();
    expect(info?.conversationId).toBe('conv-get');
  });

  it('getSessions returns all active sessions', async () => {
    await manager.getOrCreate('conv-a', { projectDir: '/tmp/test' });
    await manager.getOrCreate('conv-b', { projectDir: '/tmp/test' });
    const sessions = manager.getSessions();
    const ids = sessions.map((s) => s.conversationId);
    expect(ids).toContain('conv-a');
    expect(ids).toContain('conv-b');
  });

  it('terminate removes the session', async () => {
    await manager.getOrCreate('conv-term', { projectDir: '/tmp/test' });
    manager.terminate('conv-term');
    expect(manager.getSession('conv-term')).toBeNull();
  });

  it('terminate on non-existent session does not throw', () => {
    expect(() => manager.terminate('no-such-conv')).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Pause / handback
  // -------------------------------------------------------------------------

  it('pause marks session as paused', async () => {
    await manager.getOrCreate('conv-pause', { projectDir: '/tmp/test' });
    const result = manager.pause('conv-pause', 'manual test');
    expect(result).not.toBeNull();
    expect(manager.isPaused('conv-pause').paused).toBe(true);
  });

  it('send() on paused session yields error chunk without spawning', async () => {
    await manager.getOrCreate('conv-paused-send', { projectDir: '/tmp/test' });
    manager.pause('conv-paused-send');

    const chunks = await collectChunks(manager, 'conv-paused-send', 'hello');
    expect(chunks.some((c) => c.type === 'error')).toBe(true);
    // Spawn should NOT have been called since we short-circuited
    expect(spawn).not.toHaveBeenCalled();
  });

  it('handback restores normal operation after pause', async () => {
    await manager.getOrCreate('conv-handback', { projectDir: '/tmp/test' });
    manager.pause('conv-handback');
    const restored = await manager.handback('conv-handback');
    expect(restored).toBe(true);
    expect(manager.isPaused('conv-handback').paused).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Spawn-per-message via mocked child_process
  // -------------------------------------------------------------------------

  it('send() spawns CC and yields text chunks', async () => {
    const proc = makeFakeProc();
    setupSpawnMock(proc);

    proc.sendLines([
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi there!' } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: '', usage: { input_tokens: 5, output_tokens: 3 } }),
    ]);

    const chunks = await collectChunks(manager, 'conv-text', 'say hello');
    const textChunks = chunks.filter((c) => c.type === 'text');
    expect(textChunks.length).toBeGreaterThan(0);
    if (textChunks[0].type !== 'text') throw new Error('wrong type');
    expect(textChunks[0].text).toBe('Hi there!');
  });

  it('send() yields done chunk after result with usage', async () => {
    const proc = makeFakeProc();
    setupSpawnMock(proc);

    proc.sendLines([
      JSON.stringify({ type: 'result', subtype: 'success', result: 'done', usage: { input_tokens: 2, output_tokens: 1 } }),
    ]);

    const chunks = await collectChunks(manager, 'conv-done', 'ping');
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  it('send() yields error chunk on CC error result', async () => {
    const proc = makeFakeProc();
    setupSpawnMock(proc);

    proc.sendLines([
      JSON.stringify({ type: 'result', subtype: 'error', result: 'Permission denied' }),
    ]);

    const chunks = await collectChunks(manager, 'conv-err', 'bad command');
    const errChunks = chunks.filter((c) => c.type === 'error');
    expect(errChunks.length).toBeGreaterThan(0);
    if (errChunks[0].type !== 'error') throw new Error('wrong type');
    expect(errChunks[0].error).toContain('Permission denied');
  });

  it('send() writes JSON-encoded message to stdin', async () => {
    const proc = makeFakeProc();
    setupSpawnMock(proc);

    const stdinWrite = vi.spyOn(proc.stdin, 'write');

    proc.sendLines([
      JSON.stringify({ type: 'result', subtype: 'success', result: '', usage: { input_tokens: 1, output_tokens: 1 } }),
    ]);

    await collectChunks(manager, 'conv-stdin', 'my message');

    expect(stdinWrite).toHaveBeenCalled();
    const writtenArg = (stdinWrite.mock.calls[0][0] as string);
    const parsed = JSON.parse(writtenArg.trim());
    expect(parsed.type).toBe('user');
    expect(parsed.message.content).toBe('my message');
  });

  it('concurrent sends on different sessions work independently', async () => {
    const proc1 = makeFakeProc();
    const proc2 = makeFakeProc();
    setupSpawnMock(proc1);
    setupSpawnMock(proc2);

    proc1.sendLines([
      JSON.stringify({ type: 'result', subtype: 'success', result: 'from-1', usage: { input_tokens: 1, output_tokens: 1 } }),
    ]);
    proc2.sendLines([
      JSON.stringify({ type: 'result', subtype: 'success', result: 'from-2', usage: { input_tokens: 1, output_tokens: 1 } }),
    ]);

    const [chunks1, chunks2] = await Promise.all([
      collectChunks(manager, 'conv-concurrent-1', 'msg1', '/tmp/project1'),
      collectChunks(manager, 'conv-concurrent-2', 'msg2', '/tmp/project2'),
    ]);

    expect(chunks1.some((c) => c.type === 'done')).toBe(true);
    expect(chunks2.some((c) => c.type === 'done')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Config overrides
  // -------------------------------------------------------------------------

  it('setConfigOverrides / getConfigOverrides round-trip', async () => {
    await manager.getOrCreate('conv-override', { projectDir: '/tmp/test' });
    manager.setConfigOverrides('conv-override', { model: 'claude-opus-custom' });
    const overrides = manager.getConfigOverrides('conv-override');
    expect(overrides.model).toBe('claude-opus-custom');
  });

  it('getConfigOverrides returns empty object for unknown session', () => {
    expect(manager.getConfigOverrides('unknown')).toEqual({});
  });

  // -------------------------------------------------------------------------
  // Display name
  // -------------------------------------------------------------------------

  it('setDisplayName / getDisplayName round-trip', async () => {
    await manager.getOrCreate('conv-display', { projectDir: '/tmp/test' });
    manager.setDisplayName('conv-display', 'My Session');
    expect(manager.getDisplayName('conv-display')).toBe('My Session');
  });

  it('getDisplayName returns null before name is set', async () => {
    await manager.getOrCreate('conv-noname', { projectDir: '/tmp/test' });
    expect(manager.getDisplayName('conv-noname')).toBeNull();
  });

  it('getDisplayName returns null for unknown session', () => {
    expect(manager.getDisplayName('no-session')).toBeNull();
  });
});
