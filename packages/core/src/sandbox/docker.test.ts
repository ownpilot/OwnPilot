import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks -- used inside vi.mock() factories
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const execAsyncMock = vi.fn();
  const spawnMock = vi.fn();
  const writeFileMock = vi.fn();
  const unlinkMock = vi.fn();
  const mkdtempMock = vi.fn();
  const rmMock = vi.fn();
  const tmpdirMock = vi.fn().mockReturnValue('/tmp');
  const joinMock = vi.fn((...args: string[]) => args.join('/'));

  return {
    execAsyncMock,
    spawnMock,
    writeFileMock,
    unlinkMock,
    mkdtempMock,
    rmMock,
    tmpdirMock,
    joinMock,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: mocks.spawnMock,
}));

vi.mock('util', () => ({
  promisify: () => mocks.execAsyncMock,
}));

vi.mock('fs/promises', () => ({
  writeFile: mocks.writeFileMock,
  unlink: mocks.unlinkMock,
  mkdtemp: mocks.mkdtempMock,
  rm: mocks.rmMock,
}));

vi.mock('os', () => ({
  tmpdir: mocks.tmpdirMock,
}));

vi.mock('path', () => ({
  join: mocks.joinMock,
}));

// ---------------------------------------------------------------------------
// Helpers for building a mock ChildProcess from spawn
// ---------------------------------------------------------------------------
interface MockChildProcess {
  stdout: EventEmitter & { on: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  _emit: (event: string, ...args: unknown[]) => void;
  _emitStdout: (event: string, ...args: unknown[]) => void;
  _emitStderr: (event: string, ...args: unknown[]) => void;
}

function createMockChildProcess(): MockChildProcess {
  const stdoutListeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const stderrListeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const processListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const child: MockChildProcess = {
    stdout: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        stdoutListeners[event] = stdoutListeners[event] || [];
        stdoutListeners[event].push(handler);
      }),
    } as unknown as MockChildProcess['stdout'],
    stderr: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        stderrListeners[event] = stderrListeners[event] || [];
        stderrListeners[event].push(handler);
      }),
    } as unknown as MockChildProcess['stderr'],
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      processListeners[event] = processListeners[event] || [];
      processListeners[event].push(handler);
    }),
    kill: vi.fn(),
    _emit(event: string, ...args: unknown[]) {
      for (const handler of processListeners[event] || []) handler(...args);
    },
    _emitStdout(event: string, ...args: unknown[]) {
      for (const handler of stdoutListeners[event] || []) handler(...args);
    },
    _emitStderr(event: string, ...args: unknown[]) {
      for (const handler of stderrListeners[event] || []) handler(...args);
    },
  };

  return child;
}

/**
 * Helper that configures spawnMock to return a child process that
 * automatically emits stdout/stderr/close events once all listeners
 * are registered.
 *
 * Strategy: intercept child.on('error', ...) (the LAST listener
 * registered by runDockerContainer) and schedule event emission
 * via setTimeout(0) which fires after the current synchronous code.
 */
function setupSpawnResult(opts: {
  stdout?: string;
  stderr?: string;
  exitCode: number | null;
  emitError?: Error;
}): MockChildProcess {
  const child = createMockChildProcess();

  // Wrap child.on so that when the 'error' listener is registered
  // (last one in runDockerContainer), we schedule event emission.
  const origOn = child.on;
  let triggered = false;
  child.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    origOn(event, handler);
    if (event === 'error' && !triggered) {
      triggered = true;
      // All listeners are now registered. Use setTimeout(0) to emit
      // events as a macrotask, guaranteeing they fire after the
      // synchronous Promise constructor completes.
      setTimeout(() => {
        if (opts.emitError) {
          child._emit('error', opts.emitError);
          return;
        }
        if (opts.stdout) {
          child._emitStdout('data', Buffer.from(opts.stdout));
        }
        if (opts.stderr) {
          child._emitStderr('data', Buffer.from(opts.stderr));
        }
        child._emit('close', opts.exitCode);
      }, 0);
    }
  }) as MockChildProcess['on'];

  mocks.spawnMock.mockImplementationOnce(() => child);

  return child;
}

/**
 * Configures the common mocks needed before executeInSandbox can reach
 * the spawn call: isDockerAvailable, testSecurityFlags, ensureImage,
 * mkdtemp, writeFile, and rm.
 */
function setupExecMocks(tempDir = '/tmp/sandbox-test') {
  // isDockerAvailable
  mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
  // testSecurityFlags
  mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
  // ensureImage (docker images -q)
  mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'abc123', stderr: '' });
  // fs mocks
  mocks.mkdtempMock.mockResolvedValueOnce(tempDir);
  mocks.writeFileMock.mockResolvedValueOnce(undefined);
  mocks.rmMock.mockResolvedValueOnce(undefined);
}

// ---------------------------------------------------------------------------
// Import the module under test (fresh per test for cache isolation)
// ---------------------------------------------------------------------------
type DockerModule = typeof import('./docker.js');

async function importFreshModule(): Promise<DockerModule> {
  vi.resetModules();
  return import('./docker.js');
}

// =============================================================================
// Tests
// =============================================================================

describe('docker sandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // isDockerAvailable
  // =========================================================================
  describe('isDockerAvailable', () => {
    it('returns true when docker info succeeds', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });

      const result = await mod.isDockerAvailable();
      expect(result).toBe(true);
    });

    it('returns false when docker info fails', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('command not found'));

      const result = await mod.isDockerAvailable();
      expect(result).toBe(false);
    });

    it('caches true result across calls', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });

      await mod.isDockerAvailable();
      await mod.isDockerAvailable();
      await mod.isDockerAvailable();

      expect(mocks.execAsyncMock).toHaveBeenCalledTimes(1);
    });

    it('caches false result across calls', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('fail'));

      const r1 = await mod.isDockerAvailable();
      const r2 = await mod.isDockerAvailable();

      expect(r1).toBe(false);
      expect(r2).toBe(false);
      expect(mocks.execAsyncMock).toHaveBeenCalledTimes(1);
    });

    it('passes timeout of 5000 to exec', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

      await mod.isDockerAvailable();

      expect(mocks.execAsyncMock).toHaveBeenCalledWith('docker info', { timeout: 5000 });
    });

    it('returns fresh result after resetSandboxCache', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('fail'));

      const r1 = await mod.isDockerAvailable();
      expect(r1).toBe(false);

      mod.resetSandboxCache();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });

      const r2 = await mod.isDockerAvailable();
      expect(r2).toBe(true);
    });
  });

  // =========================================================================
  // getDockerVersion
  // =========================================================================
  describe('getDockerVersion', () => {
    it('returns trimmed version string on success', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '24.0.7\n', stderr: '' });

      const version = await mod.getDockerVersion();
      expect(version).toBe('24.0.7');
    });

    it('returns null when command fails', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('not found'));

      const version = await mod.getDockerVersion();
      expect(version).toBeNull();
    });

    it('calls docker version with format flag', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '20.10.0', stderr: '' });

      await mod.getDockerVersion();

      expect(mocks.execAsyncMock).toHaveBeenCalledWith(
        'docker version --format "{{.Server.Version}}"',
        { timeout: 5000 },
      );
    });

    it('does not cache results', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '24.0.7', stderr: '' });
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '25.0.0', stderr: '' });

      const v1 = await mod.getDockerVersion();
      const v2 = await mod.getDockerVersion();

      expect(v1).toBe('24.0.7');
      expect(v2).toBe('25.0.0');
      expect(mocks.execAsyncMock).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // testSecurityFlags
  // =========================================================================
  describe('testSecurityFlags', () => {
    it('returns true when security flag test succeeds', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'test', stderr: '' });

      const result = await mod.testSecurityFlags();
      expect(result).toBe(true);
    });

    it('returns false when "unknown flag" error occurs', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('unknown flag: --no-new-privileges'));

      const result = await mod.testSecurityFlags();
      expect(result).toBe(false);
    });

    it('returns false when "no-new-privileges" error occurs', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(
        new Error('Error: no-new-privileges not supported'),
      );

      const result = await mod.testSecurityFlags();
      expect(result).toBe(false);
    });

    it('returns false when "security-opt" error occurs', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('invalid security-opt option'));

      const result = await mod.testSecurityFlags();
      expect(result).toBe(false);
    });

    it('returns false when "invalid argument" error occurs', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('invalid argument'));

      const result = await mod.testSecurityFlags();
      expect(result).toBe(false);
    });

    it('returns false for generic errors (e.g. image not found)', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('image not found'));

      const result = await mod.testSecurityFlags();
      expect(result).toBe(false);
    });

    it('returns false for non-Error rejections', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce('string error');

      const result = await mod.testSecurityFlags();
      expect(result).toBe(false);
    });

    it('caches true result', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'test', stderr: '' });

      await mod.testSecurityFlags();
      await mod.testSecurityFlags();

      expect(mocks.execAsyncMock).toHaveBeenCalledTimes(1);
    });

    it('caches false result', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('unknown flag'));

      const r1 = await mod.testSecurityFlags();
      const r2 = await mod.testSecurityFlags();

      expect(r1).toBe(false);
      expect(r2).toBe(false);
      expect(mocks.execAsyncMock).toHaveBeenCalledTimes(1);
    });

    it('uses 30000ms timeout for the test command', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });

      await mod.testSecurityFlags();

      expect(mocks.execAsyncMock).toHaveBeenCalledWith(
        expect.stringContaining('--no-new-privileges'),
        { timeout: 30000 },
      );
    });
  });

  // =========================================================================
  // resetSandboxCache
  // =========================================================================
  describe('resetSandboxCache', () => {
    it('resets dockerAvailable cache', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });

      await mod.isDockerAvailable();
      expect(mocks.execAsyncMock).toHaveBeenCalledTimes(1);

      mod.resetSandboxCache();

      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
      await mod.isDockerAvailable();
      expect(mocks.execAsyncMock).toHaveBeenCalledTimes(2);
    });

    it('resets securityFlagsSupported cache', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });

      await mod.testSecurityFlags();
      expect(mocks.execAsyncMock).toHaveBeenCalledTimes(1);

      mod.resetSandboxCache();

      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
      await mod.testSecurityFlags();
      expect(mocks.execAsyncMock).toHaveBeenCalledTimes(2);
    });

    it('resets lastHealthCheck cache so next getSandboxStatus refreshes', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValue({ stdout: 'ok', stderr: '' });

      const status1 = await mod.checkSandboxHealth();
      const callCountAfterFirst = mocks.execAsyncMock.mock.calls.length;

      mod.resetSandboxCache();

      // After reset, getSandboxStatus without forceRefresh should still re-check
      const _status2 = await mod.getSandboxStatus(false);

      // New calls should have been made after reset
      expect(mocks.execAsyncMock.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
      expect(status1.lastChecked).toBeDefined();
    });
  });

  // =========================================================================
  // checkSandboxHealth
  // =========================================================================
  describe('checkSandboxHealth', () => {
    it('returns health status with dockerAvailable true when docker is running', async () => {
      const mod = await importFreshModule();
      // isDockerAvailable
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
      // getDockerVersion
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '24.0.7', stderr: '' });
      // testSecurityFlags
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'test', stderr: '' });
      // image checks (python, javascript, node, shell, bash)
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'abc123', stderr: '' });
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'def456', stderr: '' });
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ghi789', stderr: '' });
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const status = await mod.checkSandboxHealth();

      expect(status.dockerAvailable).toBe(true);
      expect(status.dockerVersion).toBe('24.0.7');
      expect(status.securityFlagsSupported).toBe(true);
      expect(status.relaxedSecurityRequired).toBe(false);
      expect(status.imagesAvailable.python).toBe(true);
      expect(status.imagesAvailable.javascript).toBe(true);
      expect(status.imagesAvailable.node).toBe(true);
      expect(status.imagesAvailable.shell).toBe(false);
      expect(status.imagesAvailable.bash).toBe(false);
      expect(status.lastChecked).toBeDefined();
      expect(status.error).toBeUndefined();
    });

    it('returns early with error when docker is not available', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('Docker not running'));

      const status = await mod.checkSandboxHealth();

      expect(status.dockerAvailable).toBe(false);
      expect(status.error).toBe('Docker is not available. Please install and start Docker.');
      expect(status.dockerVersion).toBeNull();
    });

    it('sets relaxedSecurityRequired when security flags are not supported', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // docker info
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '20.10.0', stderr: '' }); // version
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('unknown flag')); // security
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' }); // python img
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' }); // js img
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' }); // node img
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' }); // shell img
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' }); // bash img

      const status = await mod.checkSandboxHealth();

      expect(status.securityFlagsSupported).toBe(false);
      expect(status.relaxedSecurityRequired).toBe(true);
    });

    it('marks images as unavailable when check fails', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // docker info
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '24.0.7', stderr: '' }); // version
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // security
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('fail'));
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('fail'));
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('fail'));
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('fail'));
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('fail'));

      const status = await mod.checkSandboxHealth();

      expect(status.imagesAvailable.python).toBe(false);
      expect(status.imagesAvailable.javascript).toBe(false);
      expect(status.imagesAvailable.node).toBe(false);
      expect(status.imagesAvailable.shell).toBe(false);
      expect(status.imagesAvailable.bash).toBe(false);
    });

    it('includes lastChecked ISO timestamp', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('fail'));

      const status = await mod.checkSandboxHealth();

      expect(status.lastChecked).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('handles unexpected errors in the outer try/catch', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // docker info
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('unexpected crash')); // version

      const status = await mod.checkSandboxHealth();

      // getDockerVersion catches its own error internally, returns null
      // So no error should propagate; status is still valid
      expect(status.lastChecked).toBeDefined();
    });
  });

  // =========================================================================
  // getSandboxStatus
  // =========================================================================
  describe('getSandboxStatus', () => {
    it('returns cached status when available and fresh', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValue({ stdout: 'ok', stderr: '' });

      const status1 = await mod.checkSandboxHealth();
      vi.clearAllMocks();

      const status2 = await mod.getSandboxStatus(false);

      expect(mocks.execAsyncMock).not.toHaveBeenCalled();
      expect(status2.lastChecked).toBe(status1.lastChecked);
    });

    it('refreshes when forceRefresh is true', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValue({ stdout: 'ok', stderr: '' });

      await mod.checkSandboxHealth();
      vi.clearAllMocks();
      mocks.execAsyncMock.mockResolvedValue({ stdout: 'ok', stderr: '' });

      await mod.getSandboxStatus(true);

      expect(mocks.execAsyncMock).toHaveBeenCalled();
    });

    it('performs fresh check when no cached status exists', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValue(new Error('fail'));

      const status = await mod.getSandboxStatus();

      expect(status.dockerAvailable).toBe(false);
    });
  });

  // =========================================================================
  // ensureImage
  // =========================================================================
  describe('ensureImage', () => {
    it('returns true when image exists locally', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' });

      const result = await mod.ensureImage('python:3.11-slim');
      expect(result).toBe(true);
    });

    it('pulls image when not available locally and succeeds', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'Pulled', stderr: '' });

      const result = await mod.ensureImage('python:3.11-slim');
      expect(result).toBe(true);
      expect(mocks.execAsyncMock).toHaveBeenCalledWith('docker pull python:3.11-slim', {
        timeout: 300000,
      });
    });

    it('returns false when pull fails', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('pull failed'));

      const result = await mod.ensureImage('python:3.11-slim');
      expect(result).toBe(false);
    });

    it('rejects invalid image names with special characters', async () => {
      const mod = await importFreshModule();

      const result = await mod.ensureImage('image;rm -rf /');
      expect(result).toBe(false);
      expect(mocks.execAsyncMock).not.toHaveBeenCalled();
    });

    it('rejects image names starting with non-alphanumeric', async () => {
      const mod = await importFreshModule();

      const result = await mod.ensureImage('.hidden-image');
      expect(result).toBe(false);
    });

    it('rejects image names longer than 200 characters', async () => {
      const mod = await importFreshModule();

      const longName = 'a'.repeat(201);
      const result = await mod.ensureImage(longName);
      expect(result).toBe(false);
    });

    it('accepts valid image names with slashes, colons, and dots', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'abc123', stderr: '' });

      const result = await mod.ensureImage('registry.example.com/org/image:v1.2.3');
      expect(result).toBe(true);
    });

    it('accepts image names at exactly 200 characters', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'abc123', stderr: '' });

      const imageName = 'a'.repeat(200);
      const result = await mod.ensureImage(imageName);
      expect(result).toBe(true);
    });

    it('rejects image name with backtick for command injection', async () => {
      const mod = await importFreshModule();

      const result = await mod.ensureImage('image`whoami`');
      expect(result).toBe(false);
      expect(mocks.execAsyncMock).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // executeInSandbox
  // =========================================================================
  describe('executeInSandbox', () => {
    it('returns error when docker is not available', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('not found'));

      const result = await mod.executeInSandbox('print("hello")', 'python');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Docker is not available');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBeNull();
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('returns error when image cannot be prepared', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // docker info
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // security
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' }); // image check
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('pull failed')); // pull

      const result = await mod.executeInSandbox('print("hello")', 'python');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to prepare Docker image');
    });

    it('executes python code successfully', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-py');
      setupSpawnResult({ stdout: 'hello', exitCode: 0 });

      const result = await mod.executeInSandbox('print("hello")', 'python');

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('hello');
      expect(result.exitCode).toBe(0);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('writes code to a temp file with code.py for python', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-wf');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("test")', 'python');

      expect(mocks.writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('code.py'),
        'print("test")',
        'utf-8',
      );
    });

    it('writes code.js for javascript language', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-js');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('console.log(1)', 'javascript');

      expect(mocks.writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('code.js'),
        'console.log(1)',
        'utf-8',
      );
    });

    it('writes code.sh for shell language', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-sh');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('echo hi', 'shell');

      expect(mocks.writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('code.sh'),
        'echo hi',
        'utf-8',
      );
    });

    it('creates temp directory under os.tmpdir()', async () => {
      const mod = await importFreshModule();
      mocks.tmpdirMock.mockReturnValue('/custom/tmp');
      setupExecMocks('/custom/tmp/sandbox-123');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('x = 1', 'python');

      expect(mocks.joinMock).toHaveBeenCalledWith('/custom/tmp', 'sandbox-');
    });

    it('cleans up temp directory after execution', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-cleanup');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('x = 1', 'python');

      expect(mocks.rmMock).toHaveBeenCalledWith('/tmp/sandbox-cleanup', {
        recursive: true,
        force: true,
      });
    });

    it('cleans up temp directory even on failure', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-fail');
      setupSpawnResult({ exitCode: 1 });

      await mod.executeInSandbox('bad code', 'python');

      expect(mocks.rmMock).toHaveBeenCalledWith('/tmp/sandbox-fail', {
        recursive: true,
        force: true,
      });
    });

    it('ignores cleanup errors gracefully', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-noclean');
      mocks.rmMock.mockReset();
      mocks.rmMock.mockRejectedValueOnce(new Error('EACCES'));
      setupSpawnResult({ exitCode: 0 });

      const result = await mod.executeInSandbox('x = 1', 'python');
      expect(result.success).toBe(true);
    });

    it('captures stderr output', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-err');
      setupSpawnResult({ stderr: 'Traceback...', exitCode: 1 });

      const result = await mod.executeInSandbox('bad', 'python');

      expect(result.stderr).toBe('Traceback...');
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('reports exit code 137 as memory exceeded', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-oom');
      setupSpawnResult({ exitCode: 137 });

      const result = await mod.executeInSandbox('x = [0]*10**9', 'python');

      expect(result.memoryExceeded).toBe(true);
      expect(result.error).toBe('Memory limit exceeded');
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(137);
    });

    it('handles spawn error', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-spawnerr');
      setupSpawnResult({ exitCode: null, emitError: new Error('ENOENT') });

      const result = await mod.executeInSandbox('print("hi")', 'python');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to start container');
      expect(result.error).toContain('ENOENT');
      expect(result.exitCode).toBeNull();
    });

    it('spawns docker with correct base args', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-args');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hello")', 'python');

      expect(mocks.spawnMock).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining([
          'run',
          '--rm',
          '--read-only',
          '--memory=256m',
          '--cpus=1',
          '--pids-limit=100',
          '--hostname=sandbox',
          '--user=65534:65534',
        ]),
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    });

    it('includes security flags when security flags are supported', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-sec');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hello")', 'python');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('--no-new-privileges');
      expect(args).toContain('--cap-drop=ALL');
      expect(args).toContain('--security-opt=no-new-privileges:true');
    });

    it('uses relaxed security flags when security flags are not supported', async () => {
      const mod = await importFreshModule();
      // isDockerAvailable
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
      // testSecurityFlags fails
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('unknown flag'));
      // ensureImage
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'img', stderr: '' });
      // fs
      mocks.mkdtempMock.mockResolvedValueOnce('/tmp/sandbox-relaxed');
      mocks.writeFileMock.mockResolvedValueOnce(undefined);
      mocks.rmMock.mockResolvedValueOnce(undefined);

      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hello")', 'python');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).not.toContain('--no-new-privileges');
      expect(args).not.toContain('--cap-drop=ALL');
      expect(args).toContain('--cap-drop=SYS_ADMIN');
      expect(args).toContain('--cap-drop=NET_ADMIN');
    });

    it('uses relaxed security when config.relaxedSecurity is true', async () => {
      const mod = await importFreshModule();
      // isDockerAvailable
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
      // When relaxedSecurity is explicitly true, securityFlagsSupported is null
      // but useRelaxedSecurity starts as true, so testSecurityFlags is NOT called.
      // ensureImage
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'img', stderr: '' });
      // fs
      mocks.mkdtempMock.mockResolvedValueOnce('/tmp/sandbox-explicit');
      mocks.writeFileMock.mockResolvedValueOnce(undefined);
      mocks.rmMock.mockResolvedValueOnce(undefined);

      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hello")', 'python', {
        relaxedSecurity: true,
      });

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('--cap-drop=SYS_ADMIN');
      expect(args).toContain('--cap-drop=NET_ADMIN');
      expect(args).not.toContain('--no-new-privileges');
    });

    it('disables network by default', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-nonet');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hello")', 'python');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('--network=none');
    });

    it('enables network when networkEnabled is true', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-net');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hello")', 'python', {
        networkEnabled: true,
      });

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).not.toContain('--network=none');
    });

    it('uses custom memory and cpu limits', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-limits');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hello")', 'python', {
        memoryMB: 512,
        cpus: 2,
      });

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('--memory=512m');
      expect(args).toContain('--cpus=2');
    });

    it('passes environment variables to docker', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-env');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hello")', 'python', {
        env: { MY_VAR: 'hello', OTHER: 'world' },
      });

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('-e');
      expect(args).toContain('MY_VAR=hello');
      expect(args).toContain('OTHER=world');
    });

    it('uses custom working directory', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-wd');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hello")', 'python', {
        workDir: '/app',
      });

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      const wIndex = args.indexOf('-w');
      expect(wIndex).toBeGreaterThan(-1);
      expect(args[wIndex + 1]).toBe('/app');
    });

    it('uses correct default image for python', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-pyimg');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hello")', 'python');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('python:3.11-slim');
    });

    it('uses correct default image for javascript', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-jsimg');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('console.log("hi")', 'javascript');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('node:20-slim');
    });

    it('uses correct default image for shell', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-shimg');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('echo hello', 'shell');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('alpine:latest');
    });

    it('uses custom image when provided', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-customimg');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hi")', 'python', {
        image: 'python:3.12-slim',
      });

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('python:3.12-slim');
    });

    it('includes correct execution command for python', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-pycmd');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hi")', 'python');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args[args.length - 2]).toBe('python');
      expect(args[args.length - 1]).toBe('/sandbox/code.py');
    });

    it('includes correct execution command for javascript', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-jscmd');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('console.log("hi")', 'javascript');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args[args.length - 2]).toBe('node');
      expect(args[args.length - 1]).toBe('/sandbox/code.js');
    });

    it('includes correct execution command for shell', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-shcmd');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('echo hello', 'shell');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args[args.length - 2]).toBe('sh');
      expect(args[args.length - 1]).toBe('/sandbox/code.sh');
    });

    it('mounts temp directory as read-only volume', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-vol');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hi")', 'python');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      const vIndex = args.indexOf('-v');
      expect(vIndex).toBeGreaterThan(-1);
      expect(args[vIndex + 1]).toBe('/tmp/sandbox-vol:/sandbox:ro');
    });

    it('concatenates multiple stdout data chunks', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-multi');

      const child = createMockChildProcess();
      const origOn = child.on;
      let triggered = false;
      child.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        origOn(event, handler);
        if (event === 'error' && !triggered) {
          triggered = true;
          setTimeout(() => {
            child._emitStdout('data', Buffer.from('hello '));
            child._emitStdout('data', Buffer.from('world'));
            child._emit('close', 0);
          }, 0);
        }
      }) as MockChildProcess['on'];
      mocks.spawnMock.mockImplementationOnce(() => child);

      const result = await mod.executeInSandbox('print("hello world")', 'python');

      expect(result.stdout).toBe('hello world');
    });

    it('trims whitespace from stdout and stderr', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-trim');

      const child = createMockChildProcess();
      const origOn = child.on;
      let triggered = false;
      child.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        origOn(event, handler);
        if (event === 'error' && !triggered) {
          triggered = true;
          setTimeout(() => {
            child._emitStdout('data', Buffer.from('  output  \n'));
            child._emitStderr('data', Buffer.from('  warning  \n'));
            child._emit('close', 0);
          }, 0);
        }
      }) as MockChildProcess['on'];
      mocks.spawnMock.mockImplementationOnce(() => child);

      const result = await mod.executeInSandbox('print("hi")', 'python');

      expect(result.stdout).toBe('output');
      expect(result.stderr).toBe('warning');
    });

    it('auto-enables relaxed security when security flags cached as false', async () => {
      const mod = await importFreshModule();
      // First call: security flags fail
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // docker
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('unknown flag')); // security
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'img', stderr: '' }); // ensure
      mocks.mkdtempMock.mockResolvedValueOnce('/tmp/sandbox-auto1');
      mocks.writeFileMock.mockResolvedValueOnce(undefined);
      mocks.rmMock.mockResolvedValueOnce(undefined);
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("first")', 'python');

      // Second call: security flags cached as false, auto-relaxed
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'img', stderr: '' }); // ensure only
      mocks.mkdtempMock.mockResolvedValueOnce('/tmp/sandbox-auto2');
      mocks.writeFileMock.mockResolvedValueOnce(undefined);
      mocks.rmMock.mockResolvedValueOnce(undefined);
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("second")', 'python');

      const args2 = mocks.spawnMock.mock.calls[1][1] as string[];
      expect(args2).not.toContain('--no-new-privileges');
      expect(args2).toContain('--cap-drop=SYS_ADMIN');
    });

    it('includes default working directory /sandbox', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-defwd');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeInSandbox('print("hi")', 'python');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      const wIndex = args.indexOf('-w');
      expect(args[wIndex + 1]).toBe('/sandbox');
    });
  });

  // =========================================================================
  // executePythonSandbox
  // =========================================================================
  describe('executePythonSandbox', () => {
    it('delegates to executeInSandbox with python language', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValue(new Error('not available'));

      const result = await mod.executePythonSandbox('print("hello")');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Docker is not available');
    });

    it('passes config through to executeInSandbox', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-pyshort');
      setupSpawnResult({ exitCode: 0 });

      await mod.executePythonSandbox('print("hi")', { memoryMB: 512 });

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('--memory=512m');
      expect(args).toContain('python:3.11-slim');
    });

    it('uses python:3.11-slim image by default', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-pydefault');
      setupSpawnResult({ exitCode: 0 });

      await mod.executePythonSandbox('print(1)');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('python:3.11-slim');
      expect(args[args.length - 2]).toBe('python');
      expect(args[args.length - 1]).toBe('/sandbox/code.py');
    });
  });

  // =========================================================================
  // executeJavaScriptSandbox
  // =========================================================================
  describe('executeJavaScriptSandbox', () => {
    it('delegates to executeInSandbox with javascript language', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValue(new Error('not available'));

      const result = await mod.executeJavaScriptSandbox('console.log("hi")');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Docker is not available');
    });

    it('uses node:20-slim image by default', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-jsdef');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeJavaScriptSandbox('console.log(1)');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('node:20-slim');
      expect(args[args.length - 2]).toBe('node');
      expect(args[args.length - 1]).toBe('/sandbox/code.js');
    });

    it('passes config options through', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-jsconf');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeJavaScriptSandbox('console.log(1)', {
        memoryMB: 128,
        networkEnabled: true,
      });

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('--memory=128m');
      expect(args).not.toContain('--network=none');
    });
  });

  // =========================================================================
  // executeShellSandbox
  // =========================================================================
  describe('executeShellSandbox', () => {
    it('delegates to executeInSandbox with shell language', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValue(new Error('not available'));

      const result = await mod.executeShellSandbox('echo hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Docker is not available');
    });

    it('uses alpine:latest image by default', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-shdef');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeShellSandbox('echo hello');

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('alpine:latest');
      expect(args[args.length - 2]).toBe('sh');
      expect(args[args.length - 1]).toBe('/sandbox/code.sh');
    });

    it('passes config options through', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-shconf');
      setupSpawnResult({ exitCode: 0 });

      await mod.executeShellSandbox('ls -la', { cpus: 0.5 });

      const args = mocks.spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain('--cpus=0.5');
    });
  });

  // =========================================================================
  // Timeout handling (runDockerContainer)
  // =========================================================================
  describe('timeout handling', () => {
    it('kills the process and reports timedOut on timeout', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      try {
        const mod = await importFreshModule();
        setupExecMocks('/tmp/sandbox-timeout');

        const child = createMockChildProcess();
        child.kill.mockImplementation(() => {
          // After kill, simulate Docker container close
          child._emit('close', null);
          return true;
        });

        mocks.spawnMock.mockImplementationOnce(() => {
          // Do NOT emit 'close' -- let the timeout fire
          return child;
        });

        const promise = mod.executeInSandbox('while True: pass', 'python', {
          timeout: 1000,
        });

        // Advance time past the timeout
        await vi.advanceTimersByTimeAsync(1100);

        const result = await promise;

        expect(result.timedOut).toBe(true);
        expect(result.error).toBe('Execution timed out');
        expect(result.success).toBe(false);
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // =========================================================================
  // Output truncation
  // =========================================================================
  describe('output truncation', () => {
    it('truncates stdout exceeding 1MB and kills the process', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-trunc');

      const child = createMockChildProcess();
      child.kill.mockImplementation(() => {
        // After kill due to truncation, simulate close
        child._emit('close', null);
        return true;
      });

      const origOn = child.on;
      let triggered = false;
      child.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        origOn(event, handler);
        if (event === 'error' && !triggered) {
          triggered = true;
          setTimeout(() => {
            // Send data exceeding 1MB
            const bigChunk = Buffer.alloc(1024 * 1024 + 100, 'x');
            child._emitStdout('data', bigChunk);
          }, 0);
        }
      }) as MockChildProcess['on'];
      mocks.spawnMock.mockImplementationOnce(() => child);

      const result = await mod.executeInSandbox('print("x" * 2000000)', 'python');

      expect(result.success).toBe(false);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  // =========================================================================
  // SandboxResult shape validation
  // =========================================================================
  describe('SandboxResult shape', () => {
    it('successful execution has correct shape', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-shape');
      setupSpawnResult({ stdout: 'hi', exitCode: 0 });

      const result = await mod.executeInSandbox('print("hi")', 'python');

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          stdout: 'hi',
          stderr: '',
          exitCode: 0,
          executionTimeMs: expect.any(Number),
        }),
      );
      expect(result.timedOut).toBe(false);
      expect(result.memoryExceeded).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('failed execution with non-zero exit code has correct shape', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-failshape');
      setupSpawnResult({ stderr: 'error occurred', exitCode: 1 });

      const result = await mod.executeInSandbox('exit(1)', 'python');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('error occurred');
      expect(result.timedOut).toBe(false);
      expect(result.memoryExceeded).toBe(false);
    });

    it('docker unavailable result has correct shape', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('nope'));

      const result = await mod.executeInSandbox('print("hi")', 'python');

      expect(result).toEqual({
        success: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        executionTimeMs: expect.any(Number),
        error: expect.stringContaining('Docker is not available'),
      });
    });

    it('image preparation failure has correct shape', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // docker
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // security
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' }); // no image
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('fail')); // pull fail

      const result = await mod.executeInSandbox('print("hi")', 'python');

      expect(result).toEqual({
        success: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        executionTimeMs: expect.any(Number),
        error: expect.stringContaining('Failed to prepare Docker image'),
      });
    });
  });

  // =========================================================================
  // SandboxHealthStatus type checks
  // =========================================================================
  describe('SandboxHealthStatus type checks', () => {
    it('has all required fields when docker is available', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // docker info
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: '24.0.7', stderr: '' }); // version
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'ok', stderr: '' }); // security
      mocks.execAsyncMock.mockResolvedValue({ stdout: '', stderr: '' }); // images

      const status = await mod.checkSandboxHealth();

      expect(typeof status.dockerAvailable).toBe('boolean');
      expect(typeof status.securityFlagsSupported).toBe('boolean');
      expect(typeof status.relaxedSecurityRequired).toBe('boolean');
      expect(typeof status.imagesAvailable).toBe('object');
      expect(typeof status.lastChecked).toBe('string');
    });

    it('has all required fields when docker is not available', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockRejectedValueOnce(new Error('fail'));

      const status = await mod.checkSandboxHealth();

      expect(status.dockerAvailable).toBe(false);
      expect(status.dockerVersion).toBeNull();
      expect(status.securityFlagsSupported).toBe(false);
      expect(status.relaxedSecurityRequired).toBe(false);
      expect(status.imagesAvailable).toEqual({});
      expect(typeof status.lastChecked).toBe('string');
      expect(typeof status.error).toBe('string');
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('handles empty stdout and stderr gracefully', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-empty');
      setupSpawnResult({ exitCode: 0 });

      const result = await mod.executeInSandbox('pass', 'python');

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.success).toBe(true);
    });

    it('handles exit code null (process killed externally)', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-null');
      setupSpawnResult({ exitCode: null });

      const result = await mod.executeInSandbox('x = 1', 'python');

      expect(result.exitCode).toBeNull();
      // success = exitCode === 0 && !killed, so null !== 0 means false
      expect(result.success).toBe(false);
    });

    it('handles both stdout and stderr together', async () => {
      const mod = await importFreshModule();
      setupExecMocks('/tmp/sandbox-both');
      setupSpawnResult({ stdout: 'output', stderr: 'warning', exitCode: 0 });

      const result = await mod.executeInSandbox('print("output")', 'python');

      expect(result.stdout).toBe('output');
      expect(result.stderr).toBe('warning');
      expect(result.success).toBe(true);
    });

    it('handles ensureImage with hyphens in image names', async () => {
      const mod = await importFreshModule();
      mocks.execAsyncMock.mockResolvedValueOnce({ stdout: 'abc', stderr: '' });

      const result = await mod.ensureImage('my-registry/my-image:latest');
      expect(result).toBe(true);
    });
  });
});
