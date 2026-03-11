/**
 * Tests for OpenCodeManager.
 * TDD RED phase: written before implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { OpenCodeManager, type OpenCodeSessionInfo } from '../src/opencode-manager.ts';

// ---------------------------------------------------------------------------
// Mock child_process.spawn — uses PassThrough (proper Readable) for stdout
// ---------------------------------------------------------------------------

interface MockProcess {
  stdout: PassThrough;
  stderr: PassThrough;
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
}

function makeMockProcess(stdoutLines: string[], exitCode: number = 0): MockProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const closeCbs: Array<(code: number) => void> = [];

  const proc: MockProcess = {
    stdout,
    stderr,
    pid: 12345,
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') closeCbs.push(cb);
    }),
    kill: vi.fn(),
  };

  // Push lines into stdout and then signal close
  setImmediate(() => {
    for (const line of stdoutLines) {
      stdout.write(line + '\n');
    }
    stdout.end();
    stderr.end();
    setImmediate(() => {
      for (const cb of closeCbs) cb(exitCode);
    });
  });

  return proc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenCodeManager', () => {
  let manager: OpenCodeManager;
  let spawnFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    spawnFn = vi.fn();
    manager = new OpenCodeManager({
      opencodePath: '/fake/opencode',
      defaultModel: 'anthropic/claude-sonnet-4-6',
      spawnFn: spawnFn as unknown as OpenCodeManager['_spawnFn'],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── First message: no --session flag ──────────────────────────────────────

  it('spawns opencode without --session on first message', async () => {
    const lines = [
      '{"type":"step_start","sessionID":"ses_new1","part":{"type":"step_start"}}',
      '{"type":"text","sessionID":"ses_new1","part":{"type":"text","text":"Hello"}}',
      '{"type":"step_finish","sessionID":"ses_new1","part":{"type":"step_finish"}}',
    ];
    spawnFn.mockReturnValueOnce(makeMockProcess(lines));

    const chunks: string[] = [];
    for await (const chunk of manager.send('conv-1', 'Hi', '/project')) {
      if (chunk.type === 'text') chunks.push(chunk.text);
    }

    expect(chunks.join('')).toBe('Hello');

    // Verify spawn was called with correct args (no --session)
    const [cmd, args] = spawnFn.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('/fake/opencode');
    expect(args).toContain('run');
    expect(args).toContain('Hi');
    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(args).not.toContain('--session');
    expect(args).toContain('--dir');
    expect(args).toContain('/project');
  });

  // ─── Second message: --session flag reuses ses_xxx ─────────────────────────

  it('reuses opencode session ID on second message', async () => {
    const lines1 = [
      '{"type":"step_start","sessionID":"ses_abc","part":{"type":"step_start"}}',
      '{"type":"text","sessionID":"ses_abc","part":{"type":"text","text":"first"}}',
      '{"type":"step_finish","sessionID":"ses_abc","part":{"type":"step_finish"}}',
    ];
    const lines2 = [
      '{"type":"step_start","sessionID":"ses_abc","part":{"type":"step_start"}}',
      '{"type":"text","sessionID":"ses_abc","part":{"type":"text","text":"second"}}',
      '{"type":"step_finish","sessionID":"ses_abc","part":{"type":"step_finish"}}',
    ];
    spawnFn
      .mockReturnValueOnce(makeMockProcess(lines1))
      .mockReturnValueOnce(makeMockProcess(lines2));

    // First message
    for await (const _ of manager.send('conv-1', 'msg1', '/project')) { /* consume */ }

    // Second message
    const chunks: string[] = [];
    for await (const chunk of manager.send('conv-1', 'msg2', '/project')) {
      if (chunk.type === 'text') chunks.push(chunk.text);
    }

    expect(chunks.join('')).toBe('second');

    // Second call must have --session ses_abc
    const [, args2] = spawnFn.mock.calls[1] as [string, string[]];
    const sessionIdx = args2.indexOf('--session');
    expect(sessionIdx).toBeGreaterThan(-1);
    expect(args2[sessionIdx + 1]).toBe('ses_abc');
  });

  // ─── Model arg ─────────────────────────────────────────────────────────────

  it('passes --model flag to opencode', async () => {
    const lines = [
      '{"type":"step_start","sessionID":"ses_m1","part":{"type":"step_start"}}',
      '{"type":"step_finish","sessionID":"ses_m1","part":{"type":"step_finish"}}',
    ];
    spawnFn.mockReturnValueOnce(makeMockProcess(lines));

    for await (const _ of manager.send('conv-model', 'hi', '/p', 'anthropic/claude-opus-4-6')) { /* consume */ }

    const [, args] = spawnFn.mock.calls[0] as [string, string[]];
    const modelIdx = args.indexOf('--model');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(args[modelIdx + 1]).toBe('anthropic/claude-opus-4-6');
  });

  // ─── Session tracking ──────────────────────────────────────────────────────

  it('tracks session info after send', async () => {
    const lines = [
      '{"type":"step_start","sessionID":"ses_track","part":{"type":"step_start"}}',
      '{"type":"text","sessionID":"ses_track","part":{"type":"text","text":"done"}}',
      '{"type":"step_finish","sessionID":"ses_track","part":{"type":"step_finish"}}',
    ];
    spawnFn.mockReturnValueOnce(makeMockProcess(lines));

    for await (const _ of manager.send('conv-track', 'msg', '/my/project')) { /* consume */ }

    const info = manager.getSession('conv-track');
    expect(info).not.toBeNull();
    expect(info!.conversationId).toBe('conv-track');
    expect(info!.openCodeSessionId).toBe('ses_track');
    expect(info!.projectDir).toBe('/my/project');
    expect(info!.messagesSent).toBe(1);
  });

  it('getSessions returns all tracked sessions', async () => {
    const lines = [
      '{"type":"step_start","sessionID":"ses_all","part":{"type":"step_start"}}',
      '{"type":"step_finish","sessionID":"ses_all","part":{"type":"step_finish"}}',
    ];
    spawnFn.mockReturnValueOnce(makeMockProcess(lines));

    for await (const _ of manager.send('conv-all', 'msg', '/p')) { /* consume */ }

    const sessions = manager.getSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.some((s) => s.conversationId === 'conv-all')).toBe(true);
  });

  it('returns null for unknown session', () => {
    expect(manager.getSession('does-not-exist')).toBeNull();
  });

  // ─── StreamChunk done event ────────────────────────────────────────────────

  it('yields done chunk at end', async () => {
    const lines = [
      '{"type":"step_start","sessionID":"ses_done","part":{"type":"step_start"}}',
      '{"type":"step_finish","sessionID":"ses_done","part":{"type":"step_finish"}}',
    ];
    spawnFn.mockReturnValueOnce(makeMockProcess(lines));

    const chunks: string[] = [];
    for await (const chunk of manager.send('conv-done', 'msg', '/p')) {
      chunks.push(chunk.type);
    }

    expect(chunks[chunks.length - 1]).toBe('done');
  });

  // ─── Non-zero exit code → error chunk ─────────────────────────────────────

  it('yields error chunk on non-zero exit', async () => {
    const lines: string[] = [];
    spawnFn.mockReturnValueOnce(makeMockProcess(lines, 1));

    const chunks: Array<{ type: string; error?: string }> = [];
    for await (const chunk of manager.send('conv-err', 'msg', '/p')) {
      chunks.push(chunk as { type: string; error?: string });
    }

    expect(chunks.some((c) => c.type === 'error')).toBe(true);
  });

  // ─── Environment: OPENCODE not set in child env ────────────────────────────

  it('deletes OPENCODE env var to prevent nested session rejection', async () => {
    const lines = [
      '{"type":"step_start","sessionID":"ses_env","part":{"type":"step_start"}}',
      '{"type":"step_finish","sessionID":"ses_env","part":{"type":"step_finish"}}',
    ];
    spawnFn.mockReturnValueOnce(makeMockProcess(lines));

    for await (const _ of manager.send('conv-env', 'hi', '/p')) { /* consume */ }

    const [, , opts] = spawnFn.mock.calls[0] as [string, string[], { env?: Record<string, string | undefined> }];
    expect(opts?.env?.['OPENCODE']).toBeUndefined();
  });
});
