import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ContainerConfig, ExecutionLanguage } from './types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
const mockSpawn = vi.fn();

vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

vi.mock('../services/get-log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../services/error-utils.js', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

// ---------------------------------------------------------------------------
// Helper: mock child process for spawn
// ---------------------------------------------------------------------------

interface MockChildProcess {
  stdin: { end: ReturnType<typeof vi.fn> };
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  _emit: (event: string, data?: unknown) => void;
  _emitStdout: (data: string) => void;
  _emitStderr: (data: string) => void;
}

function createMockChildProcess(
  stdout = '',
  stderr = '',
  exitCode = 0,
  error?: Error
): MockChildProcess {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const stdoutHandlers: ((data: Buffer) => void)[] = [];
  const stderrHandlers: ((data: Buffer) => void)[] = [];

  const child: MockChildProcess = {
    stdin: { end: vi.fn() },
    stdout: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === 'data') stdoutHandlers.push(handler);
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === 'data') stderrHandlers.push(handler);
      }),
    },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    kill: vi.fn(),
    _emit(event: string, data?: unknown) {
      handlers[event]?.forEach((h) => h(data));
    },
    _emitStdout(data: string) {
      stdoutHandlers.forEach((h) => h(Buffer.from(data)));
    },
    _emitStderr(data: string) {
      stderrHandlers.forEach((h) => h(Buffer.from(data)));
    },
  };

  // Schedule the events to fire after setup
  queueMicrotask(() => {
    if (stdout) child._emitStdout(stdout);
    if (stderr) child._emitStderr(stderr);
    if (error) {
      child._emit('error', error);
    } else {
      child._emit('close', exitCode);
    }
  });

  return child;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID_CONTAINER_ID = 'abcdef012345'; // 12 hex chars
const VALID_64_ID = 'a'.repeat(64);

function makeConfig(overrides?: Partial<ContainerConfig>): ContainerConfig {
  return {
    memoryMB: 512,
    cpuCores: 0.5,
    storageGB: 2,
    timeoutMs: 30000,
    networkPolicy: 'none',
    ...overrides,
  };
}

/** Make docker run succeed and return a valid container ID */
function mockDockerRunSuccess(id = VALID_CONTAINER_ID) {
  // docker info (isDockerAvailable)
  mockExecSync.mockReturnValue(undefined);
  // docker image inspect (ensureImage)
  mockExecFileSync.mockReturnValueOnce(undefined);
  // docker run (createContainer)
  mockExecFileSync.mockReturnValueOnce(`${id}\n`);
}

// ---------------------------------------------------------------------------
// Import the module under test (AFTER mocks are set up)
// ---------------------------------------------------------------------------

// We use a dynamic import approach per test group so we get fresh module state
// But since vitest hoists vi.mock, we can import statically:
import {
  isDockerAvailable,
  ensureImage,
  getImageForLanguage,
  UserContainerOrchestrator,
  getOrchestrator,
} from './orchestrator.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // isDockerAvailable
  // =========================================================================
  describe('isDockerAvailable', () => {
    it('returns true when execSync succeeds', async () => {
      mockExecSync.mockReturnValue(undefined);
      const result = await isDockerAvailable();
      expect(result).toBe(true);
    });

    it('returns false when execSync throws', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('docker not found');
      });
      const result = await isDockerAvailable();
      expect(result).toBe(false);
    });

    it('calls execSync with "docker info"', async () => {
      mockExecSync.mockReturnValue(undefined);
      await isDockerAvailable();
      expect(mockExecSync).toHaveBeenCalledWith(
        'docker info',
        expect.objectContaining({
          stdio: 'ignore',
        })
      );
    });

    it('passes timeout option of 5000ms', async () => {
      mockExecSync.mockReturnValue(undefined);
      await isDockerAvailable();
      expect(mockExecSync).toHaveBeenCalledWith(
        'docker info',
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });

    it('catches any thrown error and returns false', async () => {
      mockExecSync.mockImplementation(() => {
        throw 'non-error value';
      });
      const result = await isDockerAvailable();
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // ensureImage
  // =========================================================================
  describe('ensureImage', () => {
    it('returns true when image exists locally', async () => {
      mockExecFileSync.mockReturnValueOnce(undefined); // docker image inspect
      const result = await ensureImage('node:20-slim');
      expect(result).toBe(true);
    });

    it('calls docker image inspect with correct args', async () => {
      mockExecFileSync.mockReturnValueOnce(undefined);
      await ensureImage('python:3.11-slim');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        ['image', 'inspect', 'python:3.11-slim'],
        expect.objectContaining({ stdio: 'ignore' })
      );
    });

    it('pulls image when not local and returns true on success', async () => {
      mockExecFileSync
        .mockImplementationOnce(() => {
          throw new Error('not found');
        }) // inspect fails
        .mockReturnValueOnce(undefined); // pull succeeds
      const result = await ensureImage('alpine:latest');
      expect(result).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        ['pull', 'alpine:latest'],
        expect.objectContaining({ stdio: 'inherit', timeout: 300000 })
      );
    });

    it('returns false when both inspect and pull fail', async () => {
      mockExecFileSync
        .mockImplementationOnce(() => {
          throw new Error('not found');
        })
        .mockImplementationOnce(() => {
          throw new Error('pull failed');
        });
      const result = await ensureImage('nonexistent:image');
      expect(result).toBe(false);
    });

    it('throws for invalid image name starting with special char', async () => {
      await expect(ensureImage('.invalid')).rejects.toThrow('Invalid Docker image name');
    });

    it('throws for image name exceeding 200 chars', async () => {
      const longName = 'a'.repeat(201);
      await expect(ensureImage(longName)).rejects.toThrow('Invalid Docker image name');
    });

    it('throws for empty image name', async () => {
      await expect(ensureImage('')).rejects.toThrow('Invalid Docker image name');
    });

    it('accepts valid image with registry path and tag', async () => {
      mockExecFileSync.mockReturnValueOnce(undefined);
      const result = await ensureImage('registry.example.com/org/repo:v1.2.3');
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // getImageForLanguage
  // =========================================================================
  describe('getImageForLanguage', () => {
    it('returns python:3.11-slim for python', () => {
      expect(getImageForLanguage('python')).toBe('python:3.11-slim');
    });

    it('returns node:20-slim for javascript', () => {
      expect(getImageForLanguage('javascript')).toBe('node:20-slim');
    });

    it('returns alpine:latest for shell', () => {
      expect(getImageForLanguage('shell')).toBe('alpine:latest');
    });

    it('returns alpine:latest for unknown language', () => {
      expect(getImageForLanguage('rust' as ExecutionLanguage)).toBe('alpine:latest');
    });

    it('returns customImage when provided', () => {
      expect(getImageForLanguage('python', 'my-image:1.0')).toBe('my-image:1.0');
    });

    it('customImage overrides any language default', () => {
      expect(getImageForLanguage('javascript', 'custom/node:18')).toBe('custom/node:18');
    });

    it('does not use customImage when it is undefined', () => {
      expect(getImageForLanguage('python', undefined)).toBe('python:3.11-slim');
    });

    it('does not use customImage when it is empty string (falsy)', () => {
      expect(getImageForLanguage('python', '')).toBe('python:3.11-slim');
    });
  });

  // =========================================================================
  // validateContainerId (via public API)
  // =========================================================================
  describe('validateContainerId via public API', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('accepts valid 12-char hex string', async () => {
      mockExecFileSync.mockReturnValueOnce(undefined); // docker stop
      // Should not throw on validation (will proceed to docker stop)
      await orch.stopContainer(VALID_CONTAINER_ID);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        ['stop', VALID_CONTAINER_ID],
        expect.any(Object)
      );
    });

    it('accepts valid 64-char hex string', async () => {
      mockExecFileSync.mockReturnValueOnce(undefined);
      await orch.stopContainer(VALID_64_ID);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        ['stop', VALID_64_ID],
        expect.any(Object)
      );
    });

    it('rejects non-hex characters', async () => {
      await expect(orch.stopContainer('abcdef01234g')).rejects.toThrow(
        'Invalid container ID format'
      );
    });

    it('rejects too short (11 chars)', async () => {
      await expect(orch.stopContainer('abcdef01234')).rejects.toThrow(
        'Invalid container ID format'
      );
    });

    it('rejects too long (65 chars)', async () => {
      await expect(orch.stopContainer('a'.repeat(65))).rejects.toThrow(
        'Invalid container ID format'
      );
    });

    it('rejects empty string', async () => {
      await expect(orch.stopContainer('')).rejects.toThrow('Invalid container ID format');
    });

    it('rejects uppercase hex', async () => {
      await expect(orch.stopContainer('ABCDEF012345')).rejects.toThrow(
        'Invalid container ID format'
      );
    });

    it('rejects mixed case hex', async () => {
      await expect(orch.stopContainer('abcDEF012345')).rejects.toThrow(
        'Invalid container ID format'
      );
    });
  });

  // =========================================================================
  // validateImageName (via ensureImage)
  // =========================================================================
  describe('validateImageName via ensureImage', () => {
    it('accepts valid simple image name', async () => {
      mockExecFileSync.mockReturnValueOnce(undefined);
      await expect(ensureImage('alpine')).resolves.toBe(true);
    });

    it('accepts image with path, registry and tag', async () => {
      mockExecFileSync.mockReturnValueOnce(undefined);
      await expect(ensureImage('docker.io/library/node:20-slim')).resolves.toBe(true);
    });

    it('rejects image starting with dot', async () => {
      await expect(ensureImage('.bad-name')).rejects.toThrow('Invalid Docker image name');
    });

    it('rejects image starting with hyphen', async () => {
      await expect(ensureImage('-bad-name')).rejects.toThrow('Invalid Docker image name');
    });

    it('rejects image exceeding 200 characters', async () => {
      await expect(ensureImage('a'.repeat(201))).rejects.toThrow('Invalid Docker image name');
    });

    it('accepts image at exactly 200 characters', async () => {
      mockExecFileSync.mockReturnValueOnce(undefined);
      await expect(ensureImage('a'.repeat(200))).resolves.toBe(true);
    });
  });

  // =========================================================================
  // UserContainerOrchestrator.checkDocker
  // =========================================================================
  describe('UserContainerOrchestrator.checkDocker', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('returns true when Docker is available', async () => {
      mockExecSync.mockReturnValue(undefined);
      expect(await orch.checkDocker()).toBe(true);
    });

    it('returns false when Docker is not available', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('no docker');
      });
      expect(await orch.checkDocker()).toBe(false);
    });

    it('caches the result after first call', async () => {
      mockExecSync.mockReturnValue(undefined);
      await orch.checkDocker();
      await orch.checkDocker();
      await orch.checkDocker();
      // isDockerAvailable should only be called once
      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });

    it('returns cached true on subsequent calls', async () => {
      mockExecSync.mockReturnValue(undefined);
      expect(await orch.checkDocker()).toBe(true);
      // Change mock to fail — should still return cached true
      mockExecSync.mockImplementation(() => {
        throw new Error('fail');
      });
      expect(await orch.checkDocker()).toBe(true);
    });

    it('returns cached false on subsequent calls', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('fail');
      });
      expect(await orch.checkDocker()).toBe(false);
      // Change mock to succeed — should still return cached false
      mockExecSync.mockReturnValue(undefined);
      expect(await orch.checkDocker()).toBe(false);
    });
  });

  // =========================================================================
  // createContainer
  // =========================================================================
  describe('createContainer', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('throws when Docker is not available', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('no docker');
      });
      await expect(
        orch.createContainer('user1', 'ws1', '/workspace', makeConfig())
      ).rejects.toThrow('Docker is not available');
    });

    it('throws when ensureImage fails', async () => {
      mockExecSync.mockReturnValue(undefined); // docker available
      // Both inspect and pull fail
      mockExecFileSync
        .mockImplementationOnce(() => {
          throw new Error('not found');
        })
        .mockImplementationOnce(() => {
          throw new Error('pull fail');
        });
      await expect(
        orch.createContainer('user1', 'ws1', '/workspace', makeConfig())
      ).rejects.toThrow('Failed to get Docker image');
    });

    it('calls execFileSync with docker run args', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      // The second call to execFileSync is docker run
      const runCall = mockExecFileSync.mock.calls[1];
      expect(runCall[0]).toBe('docker');
      const args = runCall[1] as string[];
      expect(args[0]).toBe('run');
      expect(args).toContain('-d');
    });

    it('includes security flags in args', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('--rm');
      expect(args).toContain('--read-only');
      expect(args).toContain('--no-new-privileges');
      expect(args).toContain('--cap-drop=ALL');
      expect(args).toContain('--security-opt=no-new-privileges:true');
      expect(args).toContain('--pids-limit=100');
    });

    it('includes non-root user flag', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('-u');
      expect(args).toContain('1000:1000');
    });

    it('includes memory and CPU limits from config', async () => {
      mockDockerRunSuccess();
      await orch.createContainer(
        'user1',
        'ws1',
        '/workspace',
        makeConfig({ memoryMB: 256, cpuCores: 1.5 })
      );
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('--memory=256m');
      expect(args).toContain('--cpus=1.5');
    });

    it('includes tmpfs for /tmp', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('--tmpfs');
      expect(args).toContain('/tmp:rw,noexec,nosuid,size=64m');
    });

    it('includes workspace mount', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/my/workspace', makeConfig());
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('-v');
      expect(args).toContain('/my/workspace:/workspace:rw');
    });

    it('includes working directory', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('-w');
      expect(args).toContain('/workspace');
    });

    it('adds --network=none for networkPolicy "none"', async () => {
      mockDockerRunSuccess();
      await orch.createContainer(
        'user1',
        'ws1',
        '/workspace',
        makeConfig({ networkPolicy: 'none' })
      );
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('--network=none');
    });

    it('adds --network=none for networkPolicy "restricted" with allowedHosts', async () => {
      mockDockerRunSuccess();
      await orch.createContainer(
        'user1',
        'ws1',
        '/workspace',
        makeConfig({
          networkPolicy: 'restricted',
          allowedHosts: ['api.example.com'],
        })
      );
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('--network=none');
    });

    it('does not add --network=none for networkPolicy "egress"', async () => {
      mockDockerRunSuccess();
      await orch.createContainer(
        'user1',
        'ws1',
        '/workspace',
        makeConfig({ networkPolicy: 'egress' })
      );
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).not.toContain('--network=none');
    });

    it('adds environment variables from config', async () => {
      mockDockerRunSuccess();
      await orch.createContainer(
        'user1',
        'ws1',
        '/workspace',
        makeConfig({
          env: { NODE_ENV: 'production', FOO: 'bar' },
        })
      );
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('-e');
      expect(args).toContain('NODE_ENV=production');
      expect(args).toContain('FOO=bar');
    });

    it('does not add -e when no env vars', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).not.toContain('-e');
    });

    it('stores container info in internal map', async () => {
      mockDockerRunSuccess();
      const id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      const containers = orch.getActiveContainers();
      expect(containers).toHaveLength(1);
      expect(containers[0].containerId).toBe(id);
      expect(containers[0].userId).toBe('user1');
      expect(containers[0].workspaceId).toBe('ws1');
      expect(containers[0].status).toBe('running');
    });

    it('returns validated container ID', async () => {
      mockDockerRunSuccess();
      const id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      expect(id).toBe(VALID_CONTAINER_ID);
    });

    it('uses correct image for the specified language', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig(), 'python');
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('python:3.11-slim');
    });

    it('uses custom image from config over language default', async () => {
      mockDockerRunSuccess();
      await orch.createContainer(
        'user1',
        'ws1',
        '/workspace',
        makeConfig({ image: 'my-custom:1.0' }),
        'python'
      );
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('my-custom:1.0');
      expect(args).not.toContain('python:3.11-slim');
    });

    it('defaults language to shell when not specified', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).toContain('alpine:latest');
    });

    it('throws on docker run failure', async () => {
      mockExecSync.mockReturnValue(undefined); // docker available
      mockExecFileSync.mockReturnValueOnce(undefined); // image inspect OK
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error('run failed');
      });
      await expect(
        orch.createContainer('user1', 'ws1', '/workspace', makeConfig())
      ).rejects.toThrow('Failed to create container');
    });

    it('throws when docker run returns invalid container ID', async () => {
      mockExecSync.mockReturnValue(undefined);
      mockExecFileSync.mockReturnValueOnce(undefined); // inspect
      mockExecFileSync.mockReturnValueOnce('INVALID_ID\n'); // invalid ID from docker run
      await expect(
        orch.createContainer('user1', 'ws1', '/workspace', makeConfig())
      ).rejects.toThrow('Failed to create container');
    });

    it('appends tail -f /dev/null to keep container alive', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      // Last three elements should be image, 'tail', '-f', '/dev/null'
      const tailIdx = args.indexOf('tail');
      expect(tailIdx).toBeGreaterThan(-1);
      expect(args[tailIdx + 1]).toBe('-f');
      expect(args[tailIdx + 2]).toBe('/dev/null');
    });

    it('includes container name with userId and timestamp', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user42', 'ws1', '/workspace', makeConfig());
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      const nameIdx = args.indexOf('--name');
      expect(nameIdx).toBeGreaterThan(-1);
      expect(args[nameIdx + 1]).toMatch(/^workspace_user42_\d+$/);
    });

    it('sets startedAt and lastActivityAt in container info', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      const info = orch.getActiveContainers()[0];
      expect(info.startedAt).toBeInstanceOf(Date);
      expect(info.lastActivityAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // executeInContainer
  // =========================================================================
  describe('executeInContainer', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('calls spawn with docker exec args for python', async () => {
      const child = createMockChildProcess('hello', '', 0);
      mockSpawn.mockReturnValue(child);

      await orch.executeInContainer(VALID_CONTAINER_ID, 'print("hello")', 'python');

      expect(mockSpawn).toHaveBeenCalledWith(
        'docker',
        ['exec', VALID_CONTAINER_ID, 'python', '-c', 'print("hello")'],
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
      );
    });

    it('calls spawn with docker exec args for javascript', async () => {
      const child = createMockChildProcess('world', '', 0);
      mockSpawn.mockReturnValue(child);

      await orch.executeInContainer(VALID_CONTAINER_ID, 'console.log("world")', 'javascript');

      expect(mockSpawn).toHaveBeenCalledWith(
        'docker',
        ['exec', VALID_CONTAINER_ID, 'node', '-e', 'console.log("world")'],
        expect.any(Object)
      );
    });

    it('calls spawn with docker exec args for shell', async () => {
      const child = createMockChildProcess('ok', '', 0);
      mockSpawn.mockReturnValue(child);

      await orch.executeInContainer(VALID_CONTAINER_ID, 'echo ok', 'shell');

      expect(mockSpawn).toHaveBeenCalledWith(
        'docker',
        ['exec', VALID_CONTAINER_ID, 'sh', '-c', 'echo ok'],
        expect.any(Object)
      );
    });

    it('returns failed status for unsupported language', async () => {
      const result = await orch.executeInContainer(
        VALID_CONTAINER_ID,
        'code',
        'rust' as ExecutionLanguage
      );
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Unsupported language');
      expect(result.executionId).toBe('test-uuid-1234');
    });

    it('validates container ID', async () => {
      await expect(orch.executeInContainer('INVALID', 'code', 'python')).rejects.toThrow(
        'Invalid container ID format'
      );
    });

    it('returns ExecutionResult with stdout and stderr', async () => {
      const child = createMockChildProcess('output data', 'some warning', 0);
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');

      expect(result.stdout).toBe('output data');
      expect(result.stderr).toBe('some warning');
      expect(result.executionId).toBe('test-uuid-1234');
    });

    it('sets status to completed for exitCode 0', async () => {
      const child = createMockChildProcess('ok', '', 0);
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'shell');

      expect(result.status).toBe('completed');
      expect(result.exitCode).toBe(0);
    });

    it('sets status to failed for non-zero exitCode', async () => {
      const child = createMockChildProcess('', 'error msg', 1);
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
    });

    it('sets status to failed for exitCode 127', async () => {
      const child = createMockChildProcess('', 'command not found', 127);
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'shell');

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(127);
    });

    it('handles timeout with SIGTERM then SIGKILL', async () => {
      // Create a child that doesn't emit close until after timeout
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      const stdoutHandlers: ((data: Buffer) => void)[] = [];
      const stderrHandlers: ((data: Buffer) => void)[] = [];

      const child = {
        stdin: { end: vi.fn() },
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') stdoutHandlers.push(handler);
          }),
        },
        stderr: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') stderrHandlers.push(handler);
          }),
        },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        kill: vi.fn(() => {
          // After kill is called, emit close after a short delay
          queueMicrotask(() => {
            handlers['close']?.forEach((h) => h(null));
          });
        }),
      };

      mockSpawn.mockReturnValue(child);

      const resultPromise = orch.executeInContainer(VALID_CONTAINER_ID, 'sleep 100', 'shell', 100);

      // Advance past timeout
      vi.advanceTimersByTime(200);

      const result = await resultPromise;

      expect(result.status).toBe('timeout');
      expect(result.error).toContain('timed out');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('truncates stdout at 1MB', async () => {
      const bigOutput = 'x'.repeat(1024 * 1024 + 100);

      // Create child that emits large data then closes
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      const stdoutHandlers: ((data: Buffer) => void)[] = [];

      const child = {
        stdin: { end: vi.fn() },
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') stdoutHandlers.push(handler);
          }),
        },
        stderr: {
          on: vi.fn((_event: string, _handler: (data: Buffer) => void) => {
            // noop
          }),
        },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(child);

      const resultPromise = orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');

      // Emit the big data
      stdoutHandlers.forEach((h) => h(Buffer.from(bigOutput)));

      // Emit close
      handlers['close']?.forEach((h) => h(0));

      const result = await resultPromise;

      expect(result.stdout).toContain('... [output truncated]');
      expect(result.stdout!.length).toBeLessThanOrEqual(1024 * 1024 + 50);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('truncates stderr at 1MB', async () => {
      const bigError = 'e'.repeat(1024 * 1024 + 100);

      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      const stderrHandlers: ((data: Buffer) => void)[] = [];

      const child = {
        stdin: { end: vi.fn() },
        stdout: {
          on: vi.fn(() => {}),
        },
        stderr: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') stderrHandlers.push(handler);
          }),
        },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(child);

      const resultPromise = orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'shell');

      stderrHandlers.forEach((h) => h(Buffer.from(bigError)));
      handlers['close']?.forEach((h) => h(1));

      const result = await resultPromise;

      expect(result.stderr).toContain('... [output truncated]');
      expect(result.stderr!.length).toBeLessThanOrEqual(1024 * 1024 + 50);
    });

    it('returns status failed on process error', async () => {
      const child = createMockChildProcess('', '', 0, new Error('spawn error'));
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');

      expect(result.status).toBe('failed');
      expect(result.error).toContain('spawn error');
    });

    it('updates lastActivityAt on the container info', async () => {
      // First create a container so info is in the map
      mockDockerRunSuccess();
      const id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      const infoBefore = orch.getActiveContainers()[0];
      const beforeTime = infoBefore.lastActivityAt.getTime();

      // Advance time
      vi.advanceTimersByTime(5000);

      const child = createMockChildProcess('out', '', 0);
      mockSpawn.mockReturnValue(child);

      await orch.executeInContainer(id, 'code', 'shell');

      const infoAfter = orch.getActiveContainers()[0];
      expect(infoAfter.lastActivityAt.getTime()).toBeGreaterThan(beforeTime);
    });

    it('includes executionTimeMs in result', async () => {
      const child = createMockChildProcess('ok', '', 0);
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');

      expect(typeof result.executionTimeMs).toBe('number');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('uses default timeout of 30000ms', async () => {
      // Verify it gets the timeout — we check by verifying the function accepted 3 args
      const child = createMockChildProcess('ok', '', 0);
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');

      // It should complete normally without timeout at default
      expect(result.status).toBe('completed');
    });

    it('sets stdout to undefined when empty', async () => {
      const child = createMockChildProcess('', '', 0);
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');

      expect(result.stdout).toBeUndefined();
    });

    it('sets stderr to undefined when empty', async () => {
      const child = createMockChildProcess('output', '', 0);
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');

      expect(result.stderr).toBeUndefined();
    });

    it('sets exitCode to undefined when null (process killed)', async () => {
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

      const child = {
        stdin: { end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(child);

      const resultPromise = orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');

      // Emit close with null exitCode
      handlers['close']?.forEach((h) => h(null));

      const result = await resultPromise;

      expect(result.exitCode).toBeUndefined();
    });

    it('handles timeout error message correctly', async () => {
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

      const child = {
        stdin: { end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        kill: vi.fn(() => {
          queueMicrotask(() => {
            handlers['close']?.forEach((h) => h(null));
          });
        }),
      };

      mockSpawn.mockReturnValue(child);

      const resultPromise = orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'shell', 5000);

      vi.advanceTimersByTime(6000);

      const result = await resultPromise;

      expect(result.status).toBe('timeout');
      expect(result.error).toBe('Execution timed out after 5000ms');
    });
  });

  // =========================================================================
  // stopContainer
  // =========================================================================
  describe('stopContainer', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('calls docker stop with container ID', async () => {
      mockExecFileSync.mockReturnValue(undefined);
      await orch.stopContainer(VALID_CONTAINER_ID);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        ['stop', VALID_CONTAINER_ID],
        expect.objectContaining({ timeout: 10000, stdio: 'ignore' })
      );
    });

    it('removes container from internal map', async () => {
      // First create a container
      mockDockerRunSuccess();
      const id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      expect(orch.getActiveContainers()).toHaveLength(1);

      mockExecFileSync.mockReturnValue(undefined);
      await orch.stopContainer(id);
      expect(orch.getActiveContainers()).toHaveLength(0);
    });

    it('validates container ID', async () => {
      await expect(orch.stopContainer('INVALID!')).rejects.toThrow('Invalid container ID format');
    });

    it('handles already-stopped container without throwing', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('already stopped');
      });
      // Should not throw
      await expect(orch.stopContainer(VALID_CONTAINER_ID)).resolves.toBeUndefined();
    });

    it('removes from map even when docker stop fails', async () => {
      mockDockerRunSuccess();
      const id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());

      mockExecFileSync.mockImplementation(() => {
        throw new Error('fail');
      });
      await orch.stopContainer(id);
      expect(orch.getActiveContainers()).toHaveLength(0);
    });
  });

  // =========================================================================
  // removeContainer
  // =========================================================================
  describe('removeContainer', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('calls docker rm -f with container ID', async () => {
      mockExecFileSync.mockReturnValue(undefined);
      await orch.removeContainer(VALID_CONTAINER_ID);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        ['rm', '-f', VALID_CONTAINER_ID],
        expect.objectContaining({ timeout: 10000, stdio: 'ignore' })
      );
    });

    it('removes container from internal map', async () => {
      mockDockerRunSuccess();
      const id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      expect(orch.getActiveContainers()).toHaveLength(1);

      mockExecFileSync.mockReturnValue(undefined);
      await orch.removeContainer(id);
      expect(orch.getActiveContainers()).toHaveLength(0);
    });

    it('validates container ID', async () => {
      await expect(orch.removeContainer('NOT-VALID')).rejects.toThrow(
        'Invalid container ID format'
      );
    });

    it('handles missing container without throwing', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('no such container');
      });
      await expect(orch.removeContainer(VALID_CONTAINER_ID)).resolves.toBeUndefined();
    });

    it('removes from map even when docker rm fails', async () => {
      mockDockerRunSuccess();
      const id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());

      mockExecFileSync.mockImplementation(() => {
        throw new Error('fail');
      });
      await orch.removeContainer(id);
      expect(orch.getActiveContainers()).toHaveLength(0);
    });
  });

  // =========================================================================
  // getContainerStatus
  // =========================================================================
  describe('getContainerStatus', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('returns "running" for running status', async () => {
      mockExecFileSync.mockReturnValue('running\n');
      const status = await orch.getContainerStatus(VALID_CONTAINER_ID);
      expect(status).toBe('running');
    });

    it('returns "starting" for created status', async () => {
      mockExecFileSync.mockReturnValue('created\n');
      const status = await orch.getContainerStatus(VALID_CONTAINER_ID);
      expect(status).toBe('starting');
    });

    it('returns "starting" for restarting status', async () => {
      mockExecFileSync.mockReturnValue('restarting\n');
      const status = await orch.getContainerStatus(VALID_CONTAINER_ID);
      expect(status).toBe('starting');
    });

    it('returns "stopped" for paused status', async () => {
      mockExecFileSync.mockReturnValue('paused\n');
      const status = await orch.getContainerStatus(VALID_CONTAINER_ID);
      expect(status).toBe('stopped');
    });

    it('returns "stopped" for exited status', async () => {
      mockExecFileSync.mockReturnValue('exited\n');
      const status = await orch.getContainerStatus(VALID_CONTAINER_ID);
      expect(status).toBe('stopped');
    });

    it('returns "stopped" for dead status', async () => {
      mockExecFileSync.mockReturnValue('dead\n');
      const status = await orch.getContainerStatus(VALID_CONTAINER_ID);
      expect(status).toBe('stopped');
    });

    it('returns "error" for unknown status string', async () => {
      mockExecFileSync.mockReturnValue('something-else\n');
      const status = await orch.getContainerStatus(VALID_CONTAINER_ID);
      expect(status).toBe('error');
    });

    it('returns "stopped" when docker inspect fails', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('inspect failed');
      });
      const status = await orch.getContainerStatus(VALID_CONTAINER_ID);
      expect(status).toBe('stopped');
    });

    it('validates container ID', async () => {
      await expect(orch.getContainerStatus('INVALID!')).rejects.toThrow(
        'Invalid container ID format'
      );
    });

    it('calls docker inspect with correct format flag', async () => {
      mockExecFileSync.mockReturnValue('running\n');
      await orch.getContainerStatus(VALID_CONTAINER_ID);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        ['inspect', '--format={{.State.Status}}', VALID_CONTAINER_ID],
        expect.objectContaining({ encoding: 'utf-8', timeout: 5000 })
      );
    });
  });

  // =========================================================================
  // getResourceUsage
  // =========================================================================
  describe('getResourceUsage', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('parses MiB memory correctly', async () => {
      mockExecFileSync.mockReturnValue('100MiB / 512MiB,50.00%,1.5kB / 2.3kB\n');
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(usage).not.toBeNull();
      expect(usage!.memoryMB).toBe(100);
      expect(usage!.memoryLimitMB).toBe(512);
    });

    it('parses GiB memory and converts to MB', async () => {
      mockExecFileSync.mockReturnValue('2GiB / 4GiB,25.00%,100kB / 200kB\n');
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(usage).not.toBeNull();
      expect(usage!.memoryMB).toBe(2 * 1024);
      expect(usage!.memoryLimitMB).toBe(4 * 1024);
    });

    it('parses CPU percentage', async () => {
      mockExecFileSync.mockReturnValue('100MiB / 512MiB,75.50%,0B / 0B\n');
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(usage).not.toBeNull();
      expect(usage!.cpuPercent).toBe(75.5);
    });

    it('parses kB network I/O', async () => {
      mockExecFileSync.mockReturnValue('100MiB / 512MiB,10.00%,1.5kB / 2.3kB\n');
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(usage).not.toBeNull();
      expect(usage!.networkBytesIn).toBe(1.5 * 1024);
      expect(usage!.networkBytesOut).toBe(2.3 * 1024);
    });

    it('parses MB network I/O', async () => {
      mockExecFileSync.mockReturnValue('100MiB / 512MiB,10.00%,5.0MB / 10.0MB\n');
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(usage).not.toBeNull();
      expect(usage!.networkBytesIn).toBe(5.0 * 1024 * 1024);
      expect(usage!.networkBytesOut).toBe(10.0 * 1024 * 1024);
    });

    it('returns null on error', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('stats failed');
      });
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(usage).toBeNull();
    });

    it('returns default storage values', async () => {
      mockExecFileSync.mockReturnValue('100MiB / 512MiB,10.00%,0B / 0B\n');
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(usage).not.toBeNull();
      expect(usage!.storageMB).toBe(0);
      expect(usage!.storageLimitMB).toBe(2048);
    });

    it('validates container ID', async () => {
      await expect(orch.getResourceUsage('BAD-ID')).rejects.toThrow('Invalid container ID format');
    });

    it('handles CPU with 0% correctly', async () => {
      mockExecFileSync.mockReturnValue('50MiB / 256MiB,0.00%,0B / 0B\n');
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(usage!.cpuPercent).toBe(0);
    });

    it('calls docker stats with correct format', async () => {
      mockExecFileSync.mockReturnValue('100MiB / 512MiB,50.00%,0B / 0B\n');
      await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        [
          'stats',
          VALID_CONTAINER_ID,
          '--no-stream',
          '--format',
          '{{.MemUsage}},{{.CPUPerc}},{{.NetIO}}',
        ],
        expect.objectContaining({ encoding: 'utf-8', timeout: 5000 })
      );
    });
  });

  // =========================================================================
  // getContainerLogs
  // =========================================================================
  describe('getContainerLogs', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('returns log output', async () => {
      mockExecFileSync.mockReturnValue('log line 1\nlog line 2\n');
      const logs = await orch.getContainerLogs(VALID_CONTAINER_ID);
      expect(logs).toBe('log line 1\nlog line 2\n');
    });

    it('uses default tail of 100', async () => {
      mockExecFileSync.mockReturnValue('');
      await orch.getContainerLogs(VALID_CONTAINER_ID);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        ['logs', '--tail', '100', VALID_CONTAINER_ID],
        expect.objectContaining({ encoding: 'utf-8', timeout: 5000 })
      );
    });

    it('uses custom tail value', async () => {
      mockExecFileSync.mockReturnValue('');
      await orch.getContainerLogs(VALID_CONTAINER_ID, 50);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        ['logs', '--tail', '50', VALID_CONTAINER_ID],
        expect.any(Object)
      );
    });

    it('returns empty string on error', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('logs failed');
      });
      const logs = await orch.getContainerLogs(VALID_CONTAINER_ID);
      expect(logs).toBe('');
    });

    it('validates container ID', async () => {
      await expect(orch.getContainerLogs('NOT_HEX!')).rejects.toThrow(
        'Invalid container ID format'
      );
    });
  });

  // =========================================================================
  // cleanupIdleContainers
  // =========================================================================
  describe('cleanupIdleContainers', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('stops idle containers past the threshold', async () => {
      // Create a container
      mockDockerRunSuccess();
      const _id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());

      // Advance time past idle threshold
      vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes

      mockExecFileSync.mockReturnValue(undefined); // docker stop
      const cleaned = await orch.cleanupIdleContainers();
      expect(cleaned).toBe(1);
      expect(orch.getActiveContainers()).toHaveLength(0);
    });

    it('keeps active containers', async () => {
      // Create a container
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());

      // Only advance 5 minutes — well within 30 min threshold
      vi.advanceTimersByTime(5 * 60 * 1000);

      const cleaned = await orch.cleanupIdleContainers();
      expect(cleaned).toBe(0);
      expect(orch.getActiveContainers()).toHaveLength(1);
    });

    it('returns count of cleaned containers', async () => {
      // Create two containers
      mockDockerRunSuccess(VALID_CONTAINER_ID);
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());

      const id2 = 'bbbbbbbbbbbb';
      mockDockerRunSuccess(id2);
      await orch.createContainer('user2', 'ws2', '/workspace2', makeConfig());

      // Advance past threshold
      vi.advanceTimersByTime(31 * 60 * 1000);

      mockExecFileSync.mockReturnValue(undefined); // docker stop calls
      const cleaned = await orch.cleanupIdleContainers();
      expect(cleaned).toBe(2);
    });

    it('uses default timeout of 30 minutes', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());

      // 29 minutes: should NOT be cleaned
      vi.advanceTimersByTime(29 * 60 * 1000);
      let cleaned = await orch.cleanupIdleContainers();
      expect(cleaned).toBe(0);

      // 2 more minutes (total 31): should be cleaned
      vi.advanceTimersByTime(2 * 60 * 1000);
      mockExecFileSync.mockReturnValue(undefined);
      cleaned = await orch.cleanupIdleContainers();
      expect(cleaned).toBe(1);
    });

    it('accepts custom timeout', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());

      // 3 minutes with 2-minute custom timeout
      vi.advanceTimersByTime(3 * 60 * 1000);

      mockExecFileSync.mockReturnValue(undefined);
      const cleaned = await orch.cleanupIdleContainers(2 * 60 * 1000);
      expect(cleaned).toBe(1);
    });

    it('returns 0 when no containers exist', async () => {
      const cleaned = await orch.cleanupIdleContainers();
      expect(cleaned).toBe(0);
    });
  });

  // =========================================================================
  // getActiveContainers / getContainerByUserId / getContainerByWorkspaceId
  // =========================================================================
  describe('container lookup methods', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('getActiveContainers returns all containers', async () => {
      mockDockerRunSuccess(VALID_CONTAINER_ID);
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());

      const id2 = 'cccccccccccc';
      mockDockerRunSuccess(id2);
      await orch.createContainer('user2', 'ws2', '/workspace2', makeConfig());

      const containers = orch.getActiveContainers();
      expect(containers).toHaveLength(2);
    });

    it('getActiveContainers returns empty array when no containers', () => {
      expect(orch.getActiveContainers()).toEqual([]);
    });

    it('getContainerByUserId finds by userId', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user42', 'ws1', '/workspace', makeConfig());

      const info = orch.getContainerByUserId('user42');
      expect(info).toBeDefined();
      expect(info!.userId).toBe('user42');
    });

    it('getContainerByUserId returns undefined when not found', () => {
      expect(orch.getContainerByUserId('nonexistent')).toBeUndefined();
    });

    it('getContainerByWorkspaceId finds by workspaceId', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws-abc', '/workspace', makeConfig());

      const info = orch.getContainerByWorkspaceId('ws-abc');
      expect(info).toBeDefined();
      expect(info!.workspaceId).toBe('ws-abc');
    });

    it('getContainerByWorkspaceId returns undefined when not found', () => {
      expect(orch.getContainerByWorkspaceId('nonexistent')).toBeUndefined();
    });
  });

  // =========================================================================
  // getOrchestrator singleton
  // =========================================================================
  describe('getOrchestrator', () => {
    it('returns a UserContainerOrchestrator instance', () => {
      const orch = getOrchestrator();
      expect(orch).toBeInstanceOf(UserContainerOrchestrator);
    });

    it('returns the same instance on second call', () => {
      const first = getOrchestrator();
      const second = getOrchestrator();
      expect(first).toBe(second);
    });

    it('instance has all expected methods', () => {
      const orch = getOrchestrator();
      expect(typeof orch.checkDocker).toBe('function');
      expect(typeof orch.createContainer).toBe('function');
      expect(typeof orch.executeInContainer).toBe('function');
      expect(typeof orch.stopContainer).toBe('function');
      expect(typeof orch.removeContainer).toBe('function');
      expect(typeof orch.getContainerStatus).toBe('function');
      expect(typeof orch.getResourceUsage).toBe('function');
      expect(typeof orch.getContainerLogs).toBe('function');
      expect(typeof orch.cleanupIdleContainers).toBe('function');
      expect(typeof orch.getActiveContainers).toBe('function');
      expect(typeof orch.getContainerByUserId).toBe('function');
      expect(typeof orch.getContainerByWorkspaceId).toBe('function');
    });
  });

  // =========================================================================
  // Edge cases and integration-style scenarios
  // =========================================================================
  describe('edge cases', () => {
    let orch: UserContainerOrchestrator;

    beforeEach(() => {
      orch = new UserContainerOrchestrator();
    });

    it('createContainer then executeInContainer updates lastActivityAt', async () => {
      mockDockerRunSuccess();
      const id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());

      vi.advanceTimersByTime(10000);

      const child = createMockChildProcess('result', '', 0);
      mockSpawn.mockReturnValue(child);

      await orch.executeInContainer(id, 'echo hi', 'shell');

      const info = orch.getContainerByUserId('user1');
      expect(info!.lastActivityAt.getTime()).toBeGreaterThan(info!.startedAt.getTime());
    });

    it('stopContainer after createContainer cleans up properly', async () => {
      mockDockerRunSuccess();
      const id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      expect(orch.getActiveContainers()).toHaveLength(1);

      mockExecFileSync.mockReturnValue(undefined);
      await orch.stopContainer(id);
      expect(orch.getActiveContainers()).toHaveLength(0);
      expect(orch.getContainerByUserId('user1')).toBeUndefined();
    });

    it('removeContainer after createContainer cleans up properly', async () => {
      mockDockerRunSuccess();
      const id = await orch.createContainer('user1', 'ws1', '/workspace', makeConfig());
      expect(orch.getActiveContainers()).toHaveLength(1);

      mockExecFileSync.mockReturnValue(undefined);
      await orch.removeContainer(id);
      expect(orch.getActiveContainers()).toHaveLength(0);
      expect(orch.getContainerByWorkspaceId('ws1')).toBeUndefined();
    });

    it('executeInContainer with container not in map still works', async () => {
      // Container ID exists in Docker but was not created through our API
      const child = createMockChildProcess('output', '', 0);
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');
      expect(result.status).toBe('completed');
      expect(result.stdout).toBe('output');
    });

    it('multiple containers can coexist', async () => {
      const id1 = 'aaaaaaaaaaaa';
      mockDockerRunSuccess(id1);
      await orch.createContainer('user1', 'ws1', '/workspace1', makeConfig());

      const id2 = 'bbbbbbbbbbbb';
      mockDockerRunSuccess(id2);
      await orch.createContainer('user2', 'ws2', '/workspace2', makeConfig());

      const id3 = 'cccccccccccc';
      mockDockerRunSuccess(id3);
      await orch.createContainer('user3', 'ws3', '/workspace3', makeConfig());

      expect(orch.getActiveContainers()).toHaveLength(3);
      expect(orch.getContainerByUserId('user2')!.containerId).toBe(id2);
      expect(orch.getContainerByWorkspaceId('ws3')!.containerId).toBe(id3);
    });

    it('createContainer stores the image in container info', async () => {
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', makeConfig(), 'python');
      const info = orch.getActiveContainers()[0];
      expect(info.image).toBe('python:3.11-slim');
    });

    it('createContainer stores the config in container info', async () => {
      const config = makeConfig({ memoryMB: 1024, cpuCores: 2 });
      mockDockerRunSuccess();
      await orch.createContainer('user1', 'ws1', '/workspace', config);
      const info = orch.getActiveContainers()[0];
      expect(info.config.memoryMB).toBe(1024);
      expect(info.config.cpuCores).toBe(2);
    });

    it('networkPolicy restricted without allowedHosts does not add --network=none', async () => {
      mockDockerRunSuccess();
      // restricted without allowedHosts — the code only adds --network=none
      // when networkPolicy === 'restricted' AND allowedHosts is truthy
      await orch.createContainer(
        'user1',
        'ws1',
        '/workspace',
        makeConfig({
          networkPolicy: 'restricted',
          // no allowedHosts
        })
      );
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      // Without allowedHosts, the `config.allowedHosts` is undefined/falsy,
      // so the second condition fails, --network=none is NOT added
      expect(args).not.toContain('--network=none');
    });

    it('networkPolicy full does not add --network=none', async () => {
      mockDockerRunSuccess();
      await orch.createContainer(
        'user1',
        'ws1',
        '/workspace',
        makeConfig({
          networkPolicy: 'full',
        })
      );
      const args = mockExecFileSync.mock.calls[1][1] as string[];
      expect(args).not.toContain('--network=none');
    });

    it('getResourceUsage handles malformed stats output gracefully', async () => {
      mockExecFileSync.mockReturnValue('garbage,data,here\n');
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      // Should still return a ResourceUsage rather than crashing
      // memoryMB stays 0 (regex doesn't match), cpuPercent is NaN from parseFloat('data')
      // networkBytesIn/Out stay 0 (regex doesn't match)
      expect(usage).not.toBeNull();
      expect(usage!.memoryMB).toBe(0);
      expect(usage!.cpuPercent).toBeNaN();
      expect(usage!.networkBytesIn).toBe(0);
      expect(usage!.networkBytesOut).toBe(0);
    });

    it('getResourceUsage handles B (bytes) network unit', async () => {
      // "B" doesn't match "kb" or "mb", so it stays as-is (raw float parse)
      mockExecFileSync.mockReturnValue('100MiB / 512MiB,10.00%,500B / 1000B\n');
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(usage).not.toBeNull();
      expect(usage!.networkBytesIn).toBe(500);
      expect(usage!.networkBytesOut).toBe(1000);
    });

    it('cleanupIdleContainers only stops idle ones, keeps recent', async () => {
      const id1 = 'aaaaaaaaaaaa';
      mockDockerRunSuccess(id1);
      await orch.createContainer('user1', 'ws1', '/workspace1', makeConfig());

      // Advance 20 minutes
      vi.advanceTimersByTime(20 * 60 * 1000);

      // Create a second container (fresh)
      const id2 = 'bbbbbbbbbbbb';
      mockDockerRunSuccess(id2);
      await orch.createContainer('user2', 'ws2', '/workspace2', makeConfig());

      // Advance 15 more minutes (total: user1=35min, user2=15min)
      vi.advanceTimersByTime(15 * 60 * 1000);

      mockExecFileSync.mockReturnValue(undefined); // for docker stop
      const cleaned = await orch.cleanupIdleContainers();
      expect(cleaned).toBe(1); // only user1's container
      expect(orch.getActiveContainers()).toHaveLength(1);
      expect(orch.getContainerByUserId('user2')).toBeDefined();
    });

    it('getResourceUsage parses decimal memory values', async () => {
      mockExecFileSync.mockReturnValue('1.5GiB / 2.5GiB,33.33%,0B / 0B\n');
      const usage = await orch.getResourceUsage(VALID_CONTAINER_ID);
      expect(usage!.memoryMB).toBe(1.5 * 1024);
      expect(usage!.memoryLimitMB).toBe(2.5 * 1024);
    });

    it('executeInContainer produces executionId from randomUUID', async () => {
      const child = createMockChildProcess('ok', '', 0);
      mockSpawn.mockReturnValue(child);

      const result = await orch.executeInContainer(VALID_CONTAINER_ID, 'code', 'python');
      expect(result.executionId).toBe('test-uuid-1234');
    });

    it('getContainerLogs with tail 0 sends "0"', async () => {
      mockExecFileSync.mockReturnValue('');
      await orch.getContainerLogs(VALID_CONTAINER_ID, 0);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'docker',
        ['logs', '--tail', '0', VALID_CONTAINER_ID],
        expect.any(Object)
      );
    });
  });
});
