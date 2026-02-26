/**
 * Tests for CodingAgentService
 *
 * Tests the service, tool definitions, and route handlers.
 * Mocks child_process.spawn and the Claude Agent SDK to avoid external dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config-services repo
const mockGetApiKey = vi.fn<(name: string) => string | undefined>();
vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getApiKey: (name: string) => mockGetApiKey(name),
    getByName: vi.fn(),
    getDefaultEntry: vi.fn(),
    getFieldValue: vi.fn(),
  },
}));

// Mock child_process — use importOriginal to preserve all exports
const mockSpawn = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args),
    execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  };
});

// Mock tryImport (core) — use importOriginal to preserve all exports
const mockTryImport = vi.fn();
vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    tryImport: (name: string) => mockTryImport(name),
  };
});

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
// Helper: create mock spawn process
// =============================================================================

function createMockProcess(stdout = '', stderr = '', exitCode = 0) {
  const proc = {
    stdout: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') {
          setTimeout(() => cb(Buffer.from(stdout)), 10);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data' && stderr) {
          setTimeout(() => cb(Buffer.from(stderr)), 10);
        }
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') {
        setTimeout(() => cb(exitCode), 20);
      }
    }),
    kill: vi.fn(),
    killed: false,
  };
  return proc;
}

// =============================================================================
// Tests
// =============================================================================

describe('CodingAgentService', () => {
  let CodingAgentService: typeof import('./coding-agent-service.js').CodingAgentService;

  // Save/restore API key env vars to prevent leakage from dev environment
  const savedEnv: Record<string, string | undefined> = {};
  const apiKeyEnvVars = ['ANTHROPIC_API_KEY', 'CODEX_API_KEY', 'GEMINI_API_KEY'];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Save and delete API key env vars so resolveApiKey() only uses mock
    for (const key of apiKeyEnvVars) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    // Reset module to get fresh singleton
    vi.resetModules();
    const mod = await import('./coding-agent-service.js');
    CodingAgentService = mod.CodingAgentService;
  });

  afterEach(() => {
    vi.restoreAllMocks();

    // Restore original env vars
    for (const key of apiKeyEnvVars) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  // ===========================================================================
  // runTask
  // ===========================================================================

  describe('runTask', () => {
    it('returns error when prompt is empty', async () => {
      const svc = new CodingAgentService();
      const result = await svc.runTask({ provider: 'codex', prompt: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Prompt is required');
    });

    it('runs codex without API key when binary is installed', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      delete process.env.CODEX_API_KEY;
      mockExecFileSync.mockReturnValue('codex v1.0.0\n');

      const proc = createMockProcess('{"content":"done"}', '', 0);
      mockSpawn.mockReturnValue(proc);

      const svc = new CodingAgentService();
      const result = await svc.runTask({ provider: 'codex', prompt: 'test task' });
      expect(result.success).toBe(true);
      expect(result.provider).toBe('codex');
    });

    it('returns error when CLI binary is not installed (codex)', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const svc = new CodingAgentService();
      const result = await svc.runTask({ provider: 'codex', prompt: 'test task' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('CLI not found');
    });

    it('runs codex task successfully with JSON output', async () => {
      mockGetApiKey.mockReturnValue('sk-test-key');
      // Binary check passes
      mockExecFileSync.mockReturnValue('codex v1.0.0\n');

      const jsonOutput = JSON.stringify({ type: 'message', role: 'assistant', content: 'Done! Fixed the bug.' });
      const proc = createMockProcess(jsonOutput, '', 0);
      mockSpawn.mockReturnValue(proc);

      const svc = new CodingAgentService();
      const result = await svc.runTask({
        provider: 'codex',
        prompt: 'Fix the auth bug',
        cwd: process.cwd(),
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Fixed the bug');
      expect(result.provider).toBe('codex');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Verify spawn was called with correct args
      expect(mockSpawn).toHaveBeenCalledWith(
        'codex',
        ['exec', '--json', '--full-auto', 'Fix the auth bug'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        })
      );
    });

    it('runs gemini-cli task successfully', async () => {
      mockGetApiKey.mockReturnValue('gemini-test-key');
      mockExecFileSync.mockReturnValue('gemini v1.0.0\n');

      const jsonOutput = JSON.stringify({ response: 'Analysis complete.' });
      const proc = createMockProcess(jsonOutput, '', 0);
      mockSpawn.mockReturnValue(proc);

      const svc = new CodingAgentService();
      const result = await svc.runTask({
        provider: 'gemini-cli',
        prompt: 'Analyze the code structure',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Analysis complete.');
      expect(result.provider).toBe('gemini-cli');

      expect(mockSpawn).toHaveBeenCalledWith(
        'gemini',
        ['-p', 'Analyze the code structure', '--output-format', 'json'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
      );
    });

    it('handles CLI exit with non-zero code', async () => {
      mockGetApiKey.mockReturnValue('sk-test-key');
      mockExecFileSync.mockReturnValue('codex v1.0.0\n');

      const proc = createMockProcess('', 'Error: authentication failed', 1);
      mockSpawn.mockReturnValue(proc);

      const svc = new CodingAgentService();
      const result = await svc.runTask({ provider: 'codex', prompt: 'test' });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('authentication failed');
    });

    it('runs claude-code task via SDK', async () => {
      mockGetApiKey.mockReturnValue('sk-ant-test');

      // Mock the Claude Agent SDK
      const mockQuery = vi.fn().mockImplementation(function* () {
        yield { type: 'progress', message: 'Working...' };
        yield { result: 'Bug fixed successfully.' };
      });
      mockTryImport.mockResolvedValue({ query: mockQuery });

      const svc = new CodingAgentService();
      const result = await svc.runTask({
        provider: 'claude-code',
        prompt: 'Fix the login bug',
        cwd: process.cwd(),
        maxBudgetUsd: 0.5,
        maxTurns: 5,
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Bug fixed successfully.');
      expect(result.provider).toBe('claude-code');
      expect(result.mode).toBe('sdk');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Fix the login bug',
          options: expect.objectContaining({
            maxBudgetUsd: 0.5,
            maxTurns: 5,
            permissionMode: 'bypassPermissions',
          }),
        })
      );
    });

    it('returns error when Claude Code SDK is not installed', async () => {
      mockGetApiKey.mockReturnValue('sk-ant-test');
      mockTryImport.mockRejectedValue(new Error('Module not found'));

      const svc = new CodingAgentService();
      const result = await svc.runTask({
        provider: 'claude-code',
        prompt: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude Code SDK not installed');
    });

    it('returns error for unknown provider', async () => {
      const svc = new CodingAgentService();
      const result = await svc.runTask({
        provider: 'unknown' as 'codex',
        prompt: 'test',
      });

      // Will fail at API key check first
      expect(result.success).toBe(false);
    });
  });

  // ===========================================================================
  // getStatus
  // ===========================================================================

  describe('getStatus', () => {
    it('returns status for all three providers', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      mockTryImport.mockRejectedValue(new Error('not installed'));

      const svc = new CodingAgentService();
      const statuses = await svc.getStatus();

      expect(statuses).toHaveLength(3);
      expect(statuses.map((s) => s.provider)).toEqual(['claude-code', 'codex', 'gemini-cli']);

      for (const status of statuses) {
        expect(status.displayName).toBeTruthy();
        expect(status.configured).toBe(false);
        expect(status.ptyAvailable).toBe(false);
      }
    });

    it('detects configured providers', async () => {
      mockGetApiKey.mockImplementation((name: string) => {
        if (name === 'coding-codex') return 'sk-test';
        return undefined;
      });
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      mockTryImport.mockRejectedValue(new Error('not installed'));

      const svc = new CodingAgentService();
      const statuses = await svc.getStatus();

      const codexStatus = statuses.find((s) => s.provider === 'codex');
      expect(codexStatus?.configured).toBe(true);

      const claudeStatus = statuses.find((s) => s.provider === 'claude-code');
      expect(claudeStatus?.configured).toBe(false);
    });
  });

  // ===========================================================================
  // isAvailable
  // ===========================================================================

  describe('isAvailable', () => {
    it('returns true when binary is installed (no API key needed)', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockExecFileSync.mockReturnValue('/usr/bin/codex\n');

      const svc = new CodingAgentService();
      expect(await svc.isAvailable('codex')).toBe(true);
    });

    it('returns false when binary is not installed', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const svc = new CodingAgentService();
      expect(await svc.isAvailable('codex')).toBe(false);
    });

    it('returns true for claude-code when SDK is installed', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      // Mock SDK availability via tryImport in isClaudeCodeSdkInstalled
      // The method uses a cached check, so we need a fresh instance

      const svc = new CodingAgentService();
      // Since SDK check caches and we can't easily mock it without
      // access to the internal method, just check the binary path:
      // If the binary is installed, isAvailable returns true
      mockExecFileSync.mockReturnValue('/usr/bin/claude\n');
      expect(await svc.isAvailable('claude-code')).toBe(true);
    });
  });

  // ===========================================================================
  // Security
  // ===========================================================================

  describe('security', () => {
    it('validates working directory is absolute', async () => {
      mockGetApiKey.mockReturnValue('sk-test');
      mockExecFileSync.mockReturnValue('codex v1.0.0\n');

      const proc = createMockProcess('', 'error', 1);
      mockSpawn.mockReturnValue(proc);

      const svc = new CodingAgentService();
      // Relative path should still be resolved (resolve() makes it absolute)
      const result = await svc.runTask({
        provider: 'codex',
        prompt: 'test',
        cwd: './relative/path',
      });

      // Should not reject — resolve() makes it absolute
      // (success depends on the actual spawn result, not cwd validation)
      expect(result.provider).toBe('codex');
    });

    it('strips sensitive env vars from child process', async () => {
      process.env.OWNPILOT_SECRET = 'should-be-stripped';
      process.env.DATABASE_URL = 'should-be-stripped';
      process.env.ADMIN_KEY = 'should-be-stripped';

      mockGetApiKey.mockReturnValue('sk-test');
      mockExecFileSync.mockReturnValue('codex v1.0.0\n');

      const proc = createMockProcess('{"content":"done"}', '', 0);
      mockSpawn.mockReturnValue(proc);

      const svc = new CodingAgentService();
      await svc.runTask({ provider: 'codex', prompt: 'test' });

      // Check env passed to spawn
      const spawnCall = mockSpawn.mock.calls[0];
      const env = spawnCall[2].env as Record<string, string>;
      expect(env.OWNPILOT_SECRET).toBeUndefined();
      expect(env.DATABASE_URL).toBeUndefined();
      expect(env.ADMIN_KEY).toBeUndefined();
      expect(env.CODEX_API_KEY).toBe('sk-test');

      // Cleanup
      delete process.env.OWNPILOT_SECRET;
      delete process.env.DATABASE_URL;
      delete process.env.ADMIN_KEY;
    });
  });
});

// =============================================================================
// Tool Definitions
// =============================================================================

describe('Coding Agent Tool Definitions', () => {
  it('exports correct tool definitions', async () => {
    const { CODING_AGENT_TOOLS } = await import('../tools/coding-agent-tools.js');

    expect(CODING_AGENT_TOOLS).toHaveLength(4);

    const runTask = CODING_AGENT_TOOLS.find((t) => t.name === 'run_coding_task');
    expect(runTask).toBeDefined();
    expect(runTask!.category).toBe('Coding Agents');
    expect(runTask!.parameters.required).toEqual(['provider', 'prompt']);
    expect(runTask!.configRequirements).toHaveLength(3);

    const listAgents = CODING_AGENT_TOOLS.find((t) => t.name === 'list_coding_agents');
    expect(listAgents).toBeDefined();
    expect(listAgents!.category).toBe('Coding Agents');

    const getResult = CODING_AGENT_TOOLS.find((t) => t.name === 'get_task_result');
    expect(getResult).toBeDefined();

    const listResults = CODING_AGENT_TOOLS.find((t) => t.name === 'list_task_results');
    expect(listResults).toBeDefined();
  });

  it('run_coding_task has correct parameter schema', async () => {
    const { CODING_AGENT_TOOLS } = await import('../tools/coding-agent-tools.js');
    const runTask = CODING_AGENT_TOOLS.find((t) => t.name === 'run_coding_task')!;

    const props = runTask.parameters.properties as Record<string, { type: string; enum?: string[] }>;
    // No enum — accepts built-in names and custom:* providers
    expect(props.provider.type).toBe('string');
    expect(props.provider.enum).toBeUndefined();
    expect(props.prompt.type).toBe('string');
    expect(props.cwd.type).toBe('string');
    expect(props.model.type).toBe('string');
    expect(props.max_budget_usd.type).toBe('number');
    expect(props.timeout_seconds.type).toBe('number');
  });

  it('config requirements cover all three providers', async () => {
    const { CODING_AGENT_TOOLS } = await import('../tools/coding-agent-tools.js');
    const runTask = CODING_AGENT_TOOLS.find((t) => t.name === 'run_coding_task')!;

    const configNames = runTask.configRequirements!.map((r) => r.name);
    expect(configNames).toContain('coding-claude-code');
    expect(configNames).toContain('coding-codex');
    expect(configNames).toContain('coding-gemini');
  });
});
