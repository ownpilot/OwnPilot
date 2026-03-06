/**
 * CodingAgentPty Tests
 *
 * Tests runWithPty and spawnStreamingPty using a mocked node-pty module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockTryImport, mockLog } = vi.hoisted(() => ({
  mockTryImport: vi.fn(),
  mockLog: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@ownpilot/core', () => ({
  tryImport: mockTryImport,
  getLog: vi.fn(() => mockLog),
}));

vi.mock('./log.js', () => ({
  getLog: vi.fn(() => mockLog),
}));

import { runWithPty, spawnStreamingPty } from './coding-agent-pty.js';

// ---------------------------------------------------------------------------
// PTY Mock Helpers
// ---------------------------------------------------------------------------

function makeMockProc(
  overrides: Partial<{
    onDataFn: (data: string) => void;
    onExitFn: (e: { exitCode: number; signal?: number }) => void;
    throwOnSpawn: boolean;
  }> = {}
) {
  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((e: { exitCode: number; signal?: number }) => void) | null = null;

  const proc = {
    pid: 12345,
    onData: vi.fn((cb: (data: string) => void) => {
      dataCallback = cb;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((cb: (e: { exitCode: number; signal?: number }) => void) => {
      exitCallback = cb;
      return { dispose: vi.fn() };
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    // Helpers to simulate output and exit from test
    _emitData: (data: string) => dataCallback?.(data),
    _emitExit: (exitCode: number, signal?: number) => exitCallback?.({ exitCode, signal }),
  };

  return proc;
}

function makePtyModule(proc: ReturnType<typeof makeMockProc>, throwOnSpawn = false) {
  return {
    spawn: vi.fn(() => {
      if (throwOnSpawn) throw new Error('spawn error');
      return proc;
    }),
  };
}

// ---------------------------------------------------------------------------
// runWithPty
// ---------------------------------------------------------------------------

describe('runWithPty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when node-pty is not available', async () => {
    mockTryImport.mockRejectedValue(new Error('Module not found'));
    await expect(runWithPty('echo', ['hello'])).rejects.toThrow('node-pty is not installed');
  });

  it('resolves with output and exit code 0', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));

    const resultPromise = runWithPty('echo', ['hello']);
    // Let runWithPty's async continuation run and register proc callbacks
    await Promise.resolve();

    proc._emitData('hello world\n');
    proc._emitExit(0);

    const result = await resultPromise;
    expect(result.output).toBe('hello world');
    expect(result.exitCode).toBe(0);
  });

  it('strips ANSI escape codes from output', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));

    const resultPromise = runWithPty('echo', ['hello']);
    await Promise.resolve();

    // ANSI color code + text
    proc._emitData('\u001B[32mgreen text\u001B[0m');
    proc._emitExit(0);

    const result = await resultPromise;
    expect(result.output).toBe('green text');
    expect(result.output).not.toContain('\u001B');
  });

  it('resolves with non-zero exit code', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));

    const resultPromise = runWithPty('failing-cmd', []);
    await Promise.resolve();

    proc._emitData('error output');
    proc._emitExit(1);

    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
    expect(result.output).toBe('error output');
  });

  it('rejects when PTY spawn throws', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc, true));

    await expect(runWithPty('bad-cmd', [])).rejects.toThrow('Failed to spawn PTY process');
  });

  it('accumulates multiple data chunks', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));

    const resultPromise = runWithPty('echo', ['hello']);
    await Promise.resolve();

    proc._emitData('chunk1 ');
    proc._emitData('chunk2 ');
    proc._emitData('chunk3');
    proc._emitExit(0);

    const result = await resultPromise;
    expect(result.output).toBe('chunk1 chunk2 chunk3');
  });

  it('passes cwd and cols/rows to pty spawn', async () => {
    const proc = makeMockProc();
    const ptyMod = makePtyModule(proc);
    mockTryImport.mockResolvedValue(ptyMod);

    const resultPromise = runWithPty('echo', ['hello'], { cwd: '/workspace', cols: 80, rows: 24 });
    await Promise.resolve();
    proc._emitExit(0);
    await resultPromise;

    expect(ptyMod.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: '/workspace', cols: 80, rows: 24 })
    );
  });

  it('uses default cols=120 and rows=40 when not specified', async () => {
    const proc = makeMockProc();
    const ptyMod = makePtyModule(proc);
    mockTryImport.mockResolvedValue(ptyMod);

    const resultPromise = runWithPty('echo', []);
    await Promise.resolve();
    proc._emitExit(0);
    await resultPromise;

    expect(ptyMod.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cols: 120, rows: 40 })
    );
  });
});

// ---------------------------------------------------------------------------
// spawnStreamingPty
// ---------------------------------------------------------------------------

describe('spawnStreamingPty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when node-pty is not available', async () => {
    mockTryImport.mockRejectedValue(new Error('Module not found'));
    const callbacks = { onData: vi.fn(), onExit: vi.fn(), onError: vi.fn() };
    await expect(spawnStreamingPty('cmd', [], {}, callbacks)).rejects.toThrow(
      'node-pty is not installed'
    );
  });

  it('returns a PtyHandle with pid, write, resize, kill, dispose', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));
    const callbacks = { onData: vi.fn(), onExit: vi.fn(), onError: vi.fn() };

    const handle = await spawnStreamingPty('cmd', ['arg1'], {}, callbacks);

    expect(handle.pid).toBe(12345);
    expect(typeof handle.write).toBe('function');
    expect(typeof handle.resize).toBe('function');
    expect(typeof handle.kill).toBe('function');
    expect(typeof handle.dispose).toBe('function');
  });

  it('calls onData callback when proc emits data', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));
    const callbacks = { onData: vi.fn(), onExit: vi.fn(), onError: vi.fn() };

    await spawnStreamingPty('cmd', [], {}, callbacks);
    proc._emitData('raw \u001B[32mdata\u001B[0m');

    expect(callbacks.onData).toHaveBeenCalledWith('raw \u001B[32mdata\u001B[0m');
  });

  it('does NOT strip ANSI in streaming mode', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));
    const callbacks = { onData: vi.fn(), onExit: vi.fn(), onError: vi.fn() };

    await spawnStreamingPty('cmd', [], {}, callbacks);
    proc._emitData('\u001B[32mgreen\u001B[0m');

    // ANSI should be preserved (not stripped)
    expect(callbacks.onData).toHaveBeenCalledWith(expect.stringContaining('\u001B'));
  });

  it('calls onExit when process exits', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));
    const callbacks = { onData: vi.fn(), onExit: vi.fn(), onError: vi.fn() };

    await spawnStreamingPty('cmd', [], {}, callbacks);
    proc._emitExit(0);

    expect(callbacks.onExit).toHaveBeenCalledWith(0, undefined);
  });

  it('handle.write() delegates to proc.write()', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));
    const callbacks = { onData: vi.fn(), onExit: vi.fn(), onError: vi.fn() };

    const handle = await spawnStreamingPty('cmd', [], {}, callbacks);
    handle.write('input data\r');

    expect(proc.write).toHaveBeenCalledWith('input data\r');
  });

  it('handle.resize() delegates to proc.resize()', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));
    const callbacks = { onData: vi.fn(), onExit: vi.fn(), onError: vi.fn() };

    const handle = await spawnStreamingPty('cmd', [], {}, callbacks);
    handle.resize(100, 30);

    expect(proc.resize).toHaveBeenCalledWith(100, 30);
  });

  it('handle.kill() delegates to proc.kill()', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc));
    const callbacks = { onData: vi.fn(), onExit: vi.fn(), onError: vi.fn() };

    const handle = await spawnStreamingPty('cmd', [], {}, callbacks);
    handle.kill('SIGTERM');

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('throws when PTY spawn fails', async () => {
    const proc = makeMockProc();
    mockTryImport.mockResolvedValue(makePtyModule(proc, true));
    const callbacks = { onData: vi.fn(), onExit: vi.fn(), onError: vi.fn() };

    await expect(spawnStreamingPty('bad', [], {}, callbacks)).rejects.toThrow();
  });

  it('passes cwd and env to pty spawn', async () => {
    const proc = makeMockProc();
    const ptyMod = makePtyModule(proc);
    mockTryImport.mockResolvedValue(ptyMod);
    const callbacks = { onData: vi.fn(), onExit: vi.fn(), onError: vi.fn() };
    const env = { PATH: '/usr/bin', HOME: '/home/user' };

    await spawnStreamingPty('cmd', [], { cwd: '/home', env }, callbacks);

    expect(ptyMod.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: '/home', env })
    );
  });
});
