/**
 * Binary Utilities Tests
 *
 * Tests for isBinaryInstalled, getBinaryVersion, validateCwd,
 * createSanitizedEnv, and spawnCliProcess.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------

const { mockExecFileSync, mockSpawn } = vi.hoisted(() => {
  const mockExecFileSync = vi.fn();
  const mockSpawn = vi.fn();
  return { mockExecFileSync, mockSpawn };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    execFileSync: mockExecFileSync,
    spawn: mockSpawn,
  };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    isBuiltinProvider: vi.fn((p: string) => ['claude-code', 'codex', 'gemini-cli'].includes(p)),
  };
});

import {
  isBinaryInstalled,
  getBinaryVersion,
  validateCwd,
  createSanitizedEnv,
  spawnCliProcess,
  MAX_OUTPUT_SIZE,
} from './binary-utils.js';

// ---------------------------------------------------------------------------
// Helper: create a mock child process
// ---------------------------------------------------------------------------

function createMockProc(options: {
  stdoutData?: string[];
  stderrData?: string[];
  exitCode?: number;
  error?: Error;
  killImmediate?: boolean; // proc.killed = true after kill()
}) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
    stdio: unknown[];
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = vi.fn((signal?: string) => {
    if (options.killImmediate || signal === 'SIGKILL') {
      proc.killed = true;
    }
  });

  // Schedule events
  setImmediate(() => {
    for (const chunk of options.stdoutData ?? []) {
      proc.stdout.emit('data', Buffer.from(chunk));
    }
    for (const chunk of options.stderrData ?? []) {
      proc.stderr.emit('data', Buffer.from(chunk));
    }
    if (options.error) {
      proc.emit('error', options.error);
    } else {
      proc.emit('close', options.exitCode ?? 0);
    }
  });

  return proc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// isBinaryInstalled
// ============================================================================

describe('isBinaryInstalled', () => {
  it('returns true when binary is found', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/bin/node\n'));
    expect(isBinaryInstalled('node')).toBe(true);
  });

  it('returns false when binary is not found', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(isBinaryInstalled('nonexistent-binary')).toBe(false);
  });

  it('calls execFileSync with where on windows or which on other platforms', () => {
    mockExecFileSync.mockReturnValue(Buffer.from(''));
    isBinaryInstalled('git');
    const cmd = mockExecFileSync.mock.calls[0]![0] as string;
    expect(['where', 'which']).toContain(cmd);
    expect(mockExecFileSync.mock.calls[0]![1]).toEqual(['git']);
  });
});

// ============================================================================
// getBinaryVersion
// ============================================================================

describe('getBinaryVersion', () => {
  it('returns first line of output trimmed', () => {
    mockExecFileSync.mockReturnValue('v20.0.0\nsome extra info\n');
    const version = getBinaryVersion('node');
    expect(version).toBe('v20.0.0');
  });

  it('returns undefined when binary fails', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(getBinaryVersion('nonexistent')).toBeUndefined();
  });

  it('uses --version flag by default', () => {
    mockExecFileSync.mockReturnValue('1.0.0');
    getBinaryVersion('git');
    expect(mockExecFileSync.mock.calls[0]![1]).toEqual(['--version']);
  });

  it('accepts custom flag', () => {
    mockExecFileSync.mockReturnValue('2.0');
    getBinaryVersion('tool', '-v');
    expect(mockExecFileSync.mock.calls[0]![1]).toEqual(['-v']);
  });
});

// ============================================================================
// validateCwd
// ============================================================================

describe('validateCwd', () => {
  it('returns resolved absolute path for current directory', () => {
    const cwd = process.cwd();
    const result = validateCwd(cwd);
    expect(result).toBe(cwd);
  });

  it('resolves relative paths to absolute', () => {
    const result = validateCwd('.');
    expect(result).toBe(process.cwd());
  });

  it('handles path traversal that resolves to valid path (resolve cleans it)', () => {
    // resolve() normalizes away .., so /a/b/../c → /a/c (no .. remains)
    const cwd = process.cwd();
    const result = validateCwd(cwd + '/../..');
    // The result should be absolute
    expect(result).toBeTruthy();
    expect(require('node:path').isAbsolute(result)).toBe(true);
  });
});

// ============================================================================
// createSanitizedEnv
// ============================================================================

describe('createSanitizedEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OWNPILOT_SECRET: 'secret',
      DATABASE_URL: 'postgres://...',
      JWT_SECRET: 'jwt',
      SESSION_SECRET: 'sess',
      ADMIN_KEY: 'admin',
      CLAUDECODE: '1',
      CLAUDE_CODE: '1',
      PATH: '/usr/bin',
      NODE_ENV: 'test',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('removes OWNPILOT_ variables', () => {
    const env = createSanitizedEnv('unknown');
    expect(env.OWNPILOT_SECRET).toBeUndefined();
  });

  it('removes DATABASE_ variables', () => {
    const env = createSanitizedEnv('unknown');
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('removes JWT_SECRET', () => {
    const env = createSanitizedEnv('unknown');
    expect(env.JWT_SECRET).toBeUndefined();
  });

  it('removes SESSION_SECRET', () => {
    const env = createSanitizedEnv('unknown');
    expect(env.SESSION_SECRET).toBeUndefined();
  });

  it('removes ADMIN_KEY', () => {
    const env = createSanitizedEnv('unknown');
    expect(env.ADMIN_KEY).toBeUndefined();
  });

  it('removes CLAUDECODE and CLAUDE_CODE', () => {
    const env = createSanitizedEnv('unknown');
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE).toBeUndefined();
  });

  it('keeps non-sensitive variables', () => {
    const env = createSanitizedEnv('unknown');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.NODE_ENV).toBe('test');
  });

  it('injects API key for claude-code provider', () => {
    const env = createSanitizedEnv('claude-code', 'my-api-key');
    expect(env.ANTHROPIC_API_KEY).toBe('my-api-key');
  });

  it('injects API key for codex provider', () => {
    const env = createSanitizedEnv('codex', 'codex-key');
    expect(env.CODEX_API_KEY).toBe('codex-key');
  });

  it('injects API key for gemini-cli provider', () => {
    const env = createSanitizedEnv('gemini-cli', 'gemini-key');
    expect(env.GEMINI_API_KEY).toBe('gemini-key');
  });

  it('uses apiKeyEnvVar override when provided', () => {
    const env = createSanitizedEnv('custom-provider', 'key-value', 'CUSTOM_API_KEY');
    expect(env.CUSTOM_API_KEY).toBe('key-value');
  });

  it('does not inject key when no apiKey provided', () => {
    const env = createSanitizedEnv('claude-code');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('does not inject key for unknown non-builtin provider without override', () => {
    const env = createSanitizedEnv('some-unknown-provider', 'key');
    // isBuiltinProvider returns false → no envVarName → key not injected
    expect(Object.values(env)).not.toContain('key');
  });
});

// ============================================================================
// spawnCliProcess
// ============================================================================

describe('spawnCliProcess', () => {
  const defaultOptions = {
    env: { PATH: '/usr/bin' },
    timeout: 5000,
  };

  it('resolves with stdout, stderr, and exitCode on success', async () => {
    const proc = createMockProc({ stdoutData: ['hello world'], exitCode: 0 });
    mockSpawn.mockReturnValue(proc);

    const result = await spawnCliProcess('echo', ['hello world'], defaultOptions);
    expect(result.stdout).toBe('hello world');
    expect(result.exitCode).toBe(0);
  });

  it('captures stderr output', async () => {
    const proc = createMockProc({ stderrData: ['error msg'], exitCode: 1 });
    mockSpawn.mockReturnValue(proc);

    const result = await spawnCliProcess('cmd', [], defaultOptions);
    expect(result.stderr).toBe('error msg');
    expect(result.exitCode).toBe(1);
  });

  it('uses exitCode 1 when process closes with null code', async () => {
    const proc = createMockProc({ exitCode: -1 });
    // Override to emit null code
    setImmediate(() => proc.emit('close', null));
    const realProc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
      killed: boolean;
    };
    realProc.stdout = new EventEmitter();
    realProc.stderr = new EventEmitter();
    realProc.killed = false;
    realProc.kill = vi.fn();
    mockSpawn.mockReturnValue(realProc);
    setImmediate(() => realProc.emit('close', null));

    const result = await spawnCliProcess('cmd', [], defaultOptions);
    expect(result.exitCode).toBe(1);
  });

  it('rejects when process emits error event', async () => {
    const proc = createMockProc({ error: new Error('ENOENT: command not found') });
    mockSpawn.mockReturnValue(proc);

    await expect(spawnCliProcess('nonexistent', [], defaultOptions)).rejects.toThrow('ENOENT');
  });

  it('passes cwd and env to spawn', () => {
    const proc = createMockProc({ exitCode: 0 });
    mockSpawn.mockReturnValue(proc);

    spawnCliProcess('cmd', ['arg1'], {
      cwd: '/tmp/work',
      env: { MY_VAR: 'value' },
      timeout: 1000,
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'cmd',
      ['arg1'],
      expect.objectContaining({
        cwd: '/tmp/work',
        env: { MY_VAR: 'value' },
      })
    );
  });

  it('exports MAX_OUTPUT_SIZE constant', () => {
    expect(MAX_OUTPUT_SIZE).toBe(1_048_576);
  });

  // ── Timeout path ──────────────────────────────────────────────────────────

  it('rejects with timeout error when process exceeds timeout', async () => {
    vi.useFakeTimers();

    // Create proc that never auto-emits close
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
      killed: boolean;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    // SIGTERM kills immediately so close handler sees killed=true
    proc.kill = vi.fn((signal?: string) => {
      if (!signal || signal === 'SIGTERM') {
        proc.killed = true;
      }
    });
    mockSpawn.mockReturnValue(proc);

    const promise = spawnCliProcess('slow-cmd', [], { env: {}, timeout: 1000 });

    // Advance past the timeout to fire the timer
    await vi.advanceTimersByTimeAsync(1100);

    // Now process closes (after kill)
    proc.emit('close', 0);

    await expect(promise).rejects.toThrow('Process timed out after 1000ms');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    vi.useRealTimers();
  });

  it('sends SIGKILL when proc.killed is still false after SIGTERM grace period', async () => {
    vi.useFakeTimers();

    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
      killed: boolean;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false; // Stays false even after SIGTERM
    proc.kill = vi.fn(); // Does NOT set proc.killed = true
    mockSpawn.mockReturnValue(proc);

    const promise = spawnCliProcess('stubborn', [], { env: {}, timeout: 500 });

    // Advance past the initial timeout (fires SIGTERM + schedules inner setTimeout)
    await vi.advanceTimersByTimeAsync(600);
    // Advance past the 5s SIGKILL grace period
    await vi.advanceTimersByTimeAsync(5100);

    // Now close
    proc.emit('close', null);

    await expect(promise).rejects.toThrow('timed out');
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

    vi.useRealTimers();
  });
});
