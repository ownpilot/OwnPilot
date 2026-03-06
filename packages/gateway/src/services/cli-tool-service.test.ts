/**
 * Tests for CliToolService
 *
 * Covers listTools, executeTool, installTool, getToolPolicy,
 * setToolPolicy, refreshDiscovery, and the getCliToolService singleton.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// =============================================================================
// Hoisted mock variables
// =============================================================================

const {
  mockDiscoverTools,
  mockClearDiscoveryCache,
  mockGetPolicy,
  mockSetPolicy,
  mockGetByName,
  mockIsBinaryInstalled,
  mockValidateCwd,
  mockCreateSanitizedEnv,
  mockSpawnCliProcess,
  mockGetErrorMessage,
  mockCLI_TOOLS_BY_NAME,
} = vi.hoisted(() => {
  const mockDiscoverTools = vi.fn();
  const mockClearDiscoveryCache = vi.fn();
  const mockGetPolicy = vi.fn();
  const mockSetPolicy = vi.fn();
  const mockGetByName = vi.fn();
  const mockIsBinaryInstalled = vi.fn();
  const mockValidateCwd = vi.fn();
  const mockCreateSanitizedEnv = vi.fn();
  const mockSpawnCliProcess = vi.fn();
  const mockGetErrorMessage = vi.fn((err: unknown) =>
    err instanceof Error ? err.message : String(err)
  );

  // A mutable Map so individual tests can reconfigure it
  const mockCLI_TOOLS_BY_NAME = new Map<
    string,
    {
      name: string;
      binaryName: string;
      npxPackage?: string;
      npmPackage?: string;
      installMethods: string[];
      defaultPolicy: string;
    }
  >();

  return {
    mockDiscoverTools,
    mockClearDiscoveryCache,
    mockGetPolicy,
    mockSetPolicy,
    mockGetByName,
    mockIsBinaryInstalled,
    mockValidateCwd,
    mockCreateSanitizedEnv,
    mockSpawnCliProcess,
    mockGetErrorMessage,
    mockCLI_TOOLS_BY_NAME,
  };
});

// =============================================================================
// vi.mock declarations
// =============================================================================

vi.mock('./cli-tools-catalog.js', () => ({
  CLI_TOOLS_CATALOG: [],
  CLI_TOOLS_BY_NAME: mockCLI_TOOLS_BY_NAME,
}));

vi.mock('./cli-tools-discovery.js', () => ({
  discoverTools: (...args: unknown[]) => mockDiscoverTools(...args),
  clearDiscoveryCache: (...args: unknown[]) => mockClearDiscoveryCache(...args),
}));

vi.mock('../db/repositories/cli-tool-policies.js', () => ({
  cliToolPoliciesRepo: {
    getPolicy: (...args: unknown[]) => mockGetPolicy(...args),
    setPolicy: (...args: unknown[]) => mockSetPolicy(...args),
  },
}));

vi.mock('../db/repositories/cli-providers.js', () => ({
  cliProvidersRepo: {
    getByName: (...args: unknown[]) => mockGetByName(...args),
    listActive: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./binary-utils.js', () => ({
  isBinaryInstalled: (...args: unknown[]) => mockIsBinaryInstalled(...args),
  validateCwd: (...args: unknown[]) => mockValidateCwd(...args),
  createSanitizedEnv: (...args: unknown[]) => mockCreateSanitizedEnv(...args),
  spawnCliProcess: (...args: unknown[]) => mockSpawnCliProcess(...args),
  MAX_OUTPUT_SIZE: 1_048_576,
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getErrorMessage: (err: unknown) => mockGetErrorMessage(err),
  };
});

// =============================================================================
// Import SUT (after all vi.mock declarations)
// =============================================================================

import { CliToolService, getCliToolService } from './cli-tool-service.js';

// =============================================================================
// Fixtures
// =============================================================================

const ESLINT_ENTRY = {
  name: 'eslint',
  binaryName: 'eslint',
  npxPackage: 'eslint',
  npmPackage: 'eslint',
  installMethods: ['npm-global', 'pnpm-global', 'npx'],
  defaultPolicy: 'allowed',
};

const PRETTIER_ENTRY = {
  name: 'prettier',
  binaryName: 'prettier',
  npxPackage: 'prettier',
  npmPackage: 'prettier',
  installMethods: ['npm-global', 'pnpm-global', 'npx'],
  defaultPolicy: 'prompt',
};

/** A catalog entry with no npm/npx package (brew-style) */
const BREW_ENTRY = {
  name: 'jq',
  binaryName: 'jq',
  installMethods: ['system', 'brew'],
  defaultPolicy: 'allowed',
};

const SANITIZED_ENV = { PATH: '/usr/bin', NODE_ENV: 'test' };

// =============================================================================
// beforeEach
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Reset catalog map to a known state
  mockCLI_TOOLS_BY_NAME.clear();
  mockCLI_TOOLS_BY_NAME.set('eslint', ESLINT_ENTRY);
  mockCLI_TOOLS_BY_NAME.set('prettier', PRETTIER_ENTRY);
  mockCLI_TOOLS_BY_NAME.set('jq', BREW_ENTRY);

  // Default stubs
  mockDiscoverTools.mockResolvedValue([]);
  mockClearDiscoveryCache.mockReturnValue(undefined);
  mockGetPolicy.mockResolvedValue(null); // no custom policy → use catalog default
  mockSetPolicy.mockResolvedValue(undefined);
  mockGetByName.mockResolvedValue(null);
  mockIsBinaryInstalled.mockReturnValue(true); // binary installed by default
  mockValidateCwd.mockReturnValue('/resolved/cwd');
  mockCreateSanitizedEnv.mockReturnValue(SANITIZED_ENV);
  mockSpawnCliProcess.mockResolvedValue({ stdout: 'output', stderr: '', exitCode: 0 });
  mockGetErrorMessage.mockImplementation((err: unknown) =>
    err instanceof Error ? err.message : String(err)
  );
});

// =============================================================================
// listTools
// =============================================================================

describe('listTools', () => {
  it('delegates to discoverTools with the given userId', async () => {
    const fakeStatuses = [{ name: 'eslint', installed: true }];
    mockDiscoverTools.mockResolvedValue(fakeStatuses);

    const svc = new CliToolService();
    const result = await svc.listTools('user-42');

    expect(mockDiscoverTools).toHaveBeenCalledWith('user-42');
    expect(result).toBe(fakeStatuses);
  });

  it('uses "default" userId when none provided', async () => {
    const svc = new CliToolService();
    await svc.listTools();

    expect(mockDiscoverTools).toHaveBeenCalledWith('default');
  });
});

// =============================================================================
// executeTool
// =============================================================================

describe('executeTool', () => {
  describe('tool resolution', () => {
    it('returns errorResult when tool is not in catalog and not a custom: prefix', async () => {
      const svc = new CliToolService();
      const result = await svc.executeTool('unknown-tool', [], '/tmp', 'user-1');

      expect(result.success).toBe(false);
      expect(result.toolName).toBe('unknown-tool');
      expect(result.exitCode).toBe(-1);
      expect(result.error).toContain("Tool 'unknown-tool' not found");
      expect(result.error).toContain('list_cli_tools');
    });

    it('returns errorResult when custom: tool is not found in DB', async () => {
      mockGetByName.mockResolvedValue(null);

      const svc = new CliToolService();
      const result = await svc.executeTool('custom:mytool', [], '/tmp', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool 'custom:mytool' not found");
      expect(mockGetByName).toHaveBeenCalledWith('mytool', 'user-1');
    });

    it('resolves custom: tool successfully when found in DB', async () => {
      mockGetByName.mockResolvedValue({ binary: 'mytool' });
      mockGetPolicy.mockResolvedValue('allowed');
      mockSpawnCliProcess.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

      const svc = new CliToolService();
      const result = await svc.executeTool('custom:mytool', ['--check'], '/tmp', 'user-1');

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('custom:mytool');
      expect(mockGetByName).toHaveBeenCalledWith('mytool', 'user-1');
    });
  });

  describe('policy check', () => {
    it('returns errorResult when policy is "blocked"', async () => {
      mockGetPolicy.mockResolvedValue('blocked');

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], '/tmp', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool 'eslint' is blocked by policy");
      expect(result.error).toContain('Settings');
      // spawnCliProcess must NOT be called
      expect(mockSpawnCliProcess).not.toHaveBeenCalled();
    });

    it('executes when policy is "allowed"', async () => {
      mockGetPolicy.mockResolvedValue('allowed');

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], '/tmp', 'user-1');

      expect(result.success).toBe(true);
      expect(mockSpawnCliProcess).toHaveBeenCalled();
    });

    it('executes when policy is "prompt" (not blocked)', async () => {
      mockGetPolicy.mockResolvedValue('prompt');

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], '/tmp', 'user-1');

      expect(result.success).toBe(true);
    });
  });

  describe('validateCwd', () => {
    it('returns errorResult when validateCwd throws', async () => {
      mockGetPolicy.mockResolvedValue('allowed');
      mockValidateCwd.mockImplementation(() => {
        throw new Error('Working directory must be an absolute path: ./relative');
      });

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], './relative', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Working directory must be an absolute path');
      expect(mockSpawnCliProcess).not.toHaveBeenCalled();
    });
  });

  describe('binary resolution', () => {
    it('executes directly when binary is installed', async () => {
      mockGetPolicy.mockResolvedValue('allowed');
      mockIsBinaryInstalled.mockReturnValue(true);
      mockSpawnCliProcess.mockResolvedValue({ stdout: 'linted', stderr: '', exitCode: 0 });

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', ['--fix', 'src/'], '/project', 'user-1');

      expect(result.success).toBe(true);
      const [cmd, args] = mockSpawnCliProcess.mock.calls[0]!;
      expect(cmd).toBe('eslint');
      expect(args).toEqual(['--fix', 'src/']);
    });

    it('uses npx fallback when binary not installed and npxPackage exists and npx is installed', async () => {
      mockGetPolicy.mockResolvedValue('allowed');
      // eslint binary not installed, but npx is
      mockIsBinaryInstalled.mockImplementation((bin: string) => bin === 'npx');

      const svc = new CliToolService();
      await svc.executeTool('eslint', ['--fix'], '/project', 'user-1');

      const [cmd, args] = mockSpawnCliProcess.mock.calls[0]!;
      expect(cmd).toBe('npx');
      expect(args).toEqual(['--yes', 'eslint', '--fix']);
    });

    it('returns errorResult when binary not installed and npx also not installed', async () => {
      mockGetPolicy.mockResolvedValue('allowed');
      mockIsBinaryInstalled.mockReturnValue(false);

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], '/project', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool 'eslint' (binary: eslint) is not installed");
      expect(result.error).toContain('install_cli_tool');
      expect(mockSpawnCliProcess).not.toHaveBeenCalled();
    });

    it('returns errorResult when binary not installed and no npxPackage defined', async () => {
      mockGetPolicy.mockResolvedValue('allowed');
      // jq has no npxPackage
      mockIsBinaryInstalled.mockImplementation((bin: string) => bin === 'npx'); // npx available but no pkg

      const svc = new CliToolService();
      const result = await svc.executeTool('jq', ['.'], '/tmp', 'user-1');

      // npxPackage is undefined → can't use npx fallback
      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool 'jq' (binary: jq) is not installed");
    });
  });

  describe('spawnCliProcess', () => {
    beforeEach(() => {
      mockGetPolicy.mockResolvedValue('allowed');
      mockIsBinaryInstalled.mockReturnValue(true);
    });

    it('returns success result when exitCode is 0', async () => {
      mockSpawnCliProcess.mockResolvedValue({
        stdout: 'all clean',
        stderr: '',
        exitCode: 0,
      });

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], '/project', 'user-1');

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('all clean');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeUndefined();
      expect(result.truncated).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns success=false when exitCode is non-zero (uses stderr as error)', async () => {
      mockSpawnCliProcess.mockResolvedValue({
        stdout: '',
        stderr: 'lint errors found',
        exitCode: 1,
      });

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], '/project', 'user-1');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('lint errors found');
    });

    it('uses "Exited with code N" as error when exitCode != 0 and stderr is empty', async () => {
      mockSpawnCliProcess.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 2,
      });

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], '/project', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Exited with code 2');
    });

    it('returns errorResult when spawnCliProcess throws', async () => {
      mockSpawnCliProcess.mockRejectedValue(new Error('spawn ENOENT'));

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], '/project', 'user-1');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.error).toBe('spawn ENOENT');
    });

    it('sets truncated=true when stdout.length >= MAX_OUTPUT_SIZE', async () => {
      const bigOutput = 'x'.repeat(1_048_576); // exactly MAX_OUTPUT_SIZE
      mockSpawnCliProcess.mockResolvedValue({
        stdout: bigOutput,
        stderr: '',
        exitCode: 0,
      });

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], '/project', 'user-1');

      expect(result.truncated).toBe(true);
    });

    it('sets truncated=true when stderr.length >= MAX_OUTPUT_SIZE', async () => {
      const bigErr = 'e'.repeat(1_048_576);
      mockSpawnCliProcess.mockResolvedValue({
        stdout: '',
        stderr: bigErr,
        exitCode: 1,
      });

      const svc = new CliToolService();
      const result = await svc.executeTool('eslint', [], '/project', 'user-1');

      expect(result.truncated).toBe(true);
    });

    it('passes sanitized env and cwd to spawnCliProcess', async () => {
      mockValidateCwd.mockReturnValue('/absolute/project');
      mockCreateSanitizedEnv.mockReturnValue({ PATH: '/usr/bin' });
      mockSpawnCliProcess.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const svc = new CliToolService();
      await svc.executeTool('eslint', ['--check'], '/project', 'user-1');

      expect(mockCreateSanitizedEnv).toHaveBeenCalledWith('eslint');
      const [, , opts] = mockSpawnCliProcess.mock.calls[0]!;
      expect((opts as { cwd: string }).cwd).toBe('/absolute/project');
      expect((opts as { env: Record<string, string> }).env).toEqual({ PATH: '/usr/bin' });
    });
  });

  describe('default userId', () => {
    it('uses "default" userId when none provided', async () => {
      const svc = new CliToolService();
      await svc.executeTool('eslint', [], '/tmp');

      // getPolicy is called with 'default'
      expect(mockGetPolicy).toHaveBeenCalledWith('eslint', 'default');
    });
  });
});

// =============================================================================
// installTool
// =============================================================================

describe('installTool', () => {
  describe('validation', () => {
    it('returns errorResult when tool is not in catalog', async () => {
      const svc = new CliToolService();
      const result = await svc.installTool('nonexistent', 'npm-global', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool 'nonexistent' not found in catalog");
      expect(mockSpawnCliProcess).not.toHaveBeenCalled();
    });

    it('returns errorResult when method is not in installMethods', async () => {
      const svc = new CliToolService();
      // jq only supports 'system' and 'brew'
      const result = await svc.installTool('jq', 'npm-global', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Install method 'npm-global' is not available for 'jq'");
      expect(result.error).toContain('system');
      expect(mockSpawnCliProcess).not.toHaveBeenCalled();
    });

    it('returns errorResult when no npm package defined for npm-global method', async () => {
      // Add a catalog entry with npm-global but no pkg defined
      mockCLI_TOOLS_BY_NAME.set('nopkg', {
        name: 'nopkg',
        binaryName: 'nopkg',
        installMethods: ['npm-global'],
        defaultPolicy: 'prompt',
        // no npmPackage, no npxPackage
      });

      const svc = new CliToolService();
      const result = await svc.installTool('nopkg', 'npm-global', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("No npm package defined for 'nopkg'");
    });

    it('returns errorResult when no npm package defined for pnpm-global method', async () => {
      mockCLI_TOOLS_BY_NAME.set('nopkg2', {
        name: 'nopkg2',
        binaryName: 'nopkg2',
        installMethods: ['pnpm-global'],
        defaultPolicy: 'prompt',
      });

      const svc = new CliToolService();
      const result = await svc.installTool('nopkg2', 'pnpm-global', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("No npm package defined for 'nopkg2'");
    });
  });

  describe('npm-global', () => {
    it('spawns "npm install -g <pkg>" for npm-global method', async () => {
      mockSpawnCliProcess.mockResolvedValue({ stdout: 'installed', stderr: '', exitCode: 0 });

      const svc = new CliToolService();
      const result = await svc.installTool('eslint', 'npm-global', 'user-1');

      expect(result.success).toBe(true);
      const [cmd, args] = mockSpawnCliProcess.mock.calls[0]!;
      expect(cmd).toBe('npm');
      expect(args).toEqual(['install', '-g', 'eslint']);
    });

    it('prefers npmPackage over npxPackage', async () => {
      mockSpawnCliProcess.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const svc = new CliToolService();
      await svc.installTool('eslint', 'npm-global', 'user-1');

      const [, args] = mockSpawnCliProcess.mock.calls[0]!;
      expect(args).toContain('eslint'); // npmPackage = 'eslint'
    });

    it('falls back to npxPackage when npmPackage is absent', async () => {
      // biome has npmPackage, but let's create a no-npmPackage entry
      mockCLI_TOOLS_BY_NAME.set('mypkg', {
        name: 'mypkg',
        binaryName: 'mypkg',
        npxPackage: '@scope/mypkg',
        installMethods: ['npm-global'],
        defaultPolicy: 'allowed',
        // no npmPackage
      });
      mockSpawnCliProcess.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const svc = new CliToolService();
      const result = await svc.installTool('mypkg', 'npm-global', 'user-1');

      expect(result.success).toBe(true);
      const [cmd, args] = mockSpawnCliProcess.mock.calls[0]!;
      expect(cmd).toBe('npm');
      expect(args).toContain('@scope/mypkg');
    });
  });

  describe('pnpm-global', () => {
    it('spawns "pnpm add -g <pkg>" for pnpm-global method', async () => {
      mockSpawnCliProcess.mockResolvedValue({ stdout: 'installed', stderr: '', exitCode: 0 });

      const svc = new CliToolService();
      const result = await svc.installTool('eslint', 'pnpm-global', 'user-1');

      expect(result.success).toBe(true);
      const [cmd, args] = mockSpawnCliProcess.mock.calls[0]!;
      expect(cmd).toBe('pnpm');
      expect(args).toEqual(['add', '-g', 'eslint']);
    });
  });

  describe('other install methods', () => {
    it('returns errorResult for methods not in npm-global/pnpm-global (e.g. brew)', async () => {
      // Add brew to eslint's methods to test the default branch
      mockCLI_TOOLS_BY_NAME.set('eslint-brew', {
        name: 'eslint-brew',
        binaryName: 'eslint',
        npmPackage: 'eslint',
        installMethods: ['brew'],
        defaultPolicy: 'allowed',
      });

      const svc = new CliToolService();
      const result = await svc.installTool('eslint-brew', 'brew' as 'npm-global', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Install method 'brew' requires manual installation");
      expect(mockSpawnCliProcess).not.toHaveBeenCalled();
    });
  });

  describe('spawn result handling', () => {
    it('clears discovery cache after successful install', async () => {
      mockSpawnCliProcess.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const svc = new CliToolService();
      await svc.installTool('eslint', 'npm-global', 'user-1');

      expect(mockClearDiscoveryCache).toHaveBeenCalledWith('user-1');
    });

    it('clears discovery cache even after failed install (exitCode != 0)', async () => {
      mockSpawnCliProcess.mockResolvedValue({
        stdout: '',
        stderr: 'npm ERR! peer dep',
        exitCode: 1,
      });

      const svc = new CliToolService();
      await svc.installTool('eslint', 'npm-global', 'user-1');

      expect(mockClearDiscoveryCache).toHaveBeenCalledWith('user-1');
    });

    it('returns success=false with error when exitCode is non-zero', async () => {
      mockSpawnCliProcess.mockResolvedValue({
        stdout: '',
        stderr: 'npm ERR! 404 not found',
        exitCode: 1,
      });

      const svc = new CliToolService();
      const result = await svc.installTool('eslint', 'npm-global', 'user-1');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('npm ERR! 404 not found');
    });

    it('uses "Installation failed with code N" when stderr is empty and exitCode != 0', async () => {
      mockSpawnCliProcess.mockResolvedValue({ stdout: '', stderr: '', exitCode: 127 });

      const svc = new CliToolService();
      const result = await svc.installTool('eslint', 'npm-global', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Installation failed with code 127');
    });

    it('returns errorResult when spawnCliProcess throws', async () => {
      mockSpawnCliProcess.mockRejectedValue(new Error('ENOENT: npm not found'));

      const svc = new CliToolService();
      const result = await svc.installTool('eslint', 'npm-global', 'user-1');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.error).toBe('ENOENT: npm not found');
      // discovery cache should NOT be cleared when spawn itself throws
      expect(mockClearDiscoveryCache).not.toHaveBeenCalled();
    });

    it('uses MAX_TIMEOUT_MS for the install spawn timeout', async () => {
      mockSpawnCliProcess.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const svc = new CliToolService();
      await svc.installTool('eslint', 'npm-global', 'user-1');

      const [, , opts] = mockSpawnCliProcess.mock.calls[0]!;
      expect((opts as { timeout: number }).timeout).toBe(300_000); // MAX_TIMEOUT_MS
    });
  });

  describe('default userId', () => {
    it('uses "default" userId when none provided', async () => {
      mockSpawnCliProcess.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const svc = new CliToolService();
      await svc.installTool('eslint', 'npm-global');

      expect(mockClearDiscoveryCache).toHaveBeenCalledWith('default');
    });
  });
});

// =============================================================================
// getToolPolicy
// =============================================================================

describe('getToolPolicy', () => {
  it('returns DB policy when one exists', async () => {
    mockGetPolicy.mockResolvedValue('blocked');

    const svc = new CliToolService();
    const policy = await svc.getToolPolicy('eslint', 'user-1');

    expect(policy).toBe('blocked');
    expect(mockGetPolicy).toHaveBeenCalledWith('eslint', 'user-1');
  });

  it('falls back to catalog defaultPolicy when DB returns null', async () => {
    mockGetPolicy.mockResolvedValue(null);

    const svc = new CliToolService();
    const policy = await svc.getToolPolicy('prettier', 'user-1');

    expect(policy).toBe('prompt'); // PRETTIER_ENTRY.defaultPolicy
  });

  it('falls back to catalog defaultPolicy when DB throws', async () => {
    mockGetPolicy.mockRejectedValue(new Error('DB not ready'));

    const svc = new CliToolService();
    const policy = await svc.getToolPolicy('eslint', 'user-1');

    expect(policy).toBe('allowed'); // ESLINT_ENTRY.defaultPolicy
  });

  it('returns "prompt" when tool is not in catalog and DB throws', async () => {
    mockGetPolicy.mockRejectedValue(new Error('DB not ready'));

    const svc = new CliToolService();
    const policy = await svc.getToolPolicy('unknown-tool', 'user-1');

    expect(policy).toBe('prompt');
  });

  it('returns "prompt" when tool is not in catalog and DB returns null', async () => {
    mockGetPolicy.mockResolvedValue(null);

    const svc = new CliToolService();
    const policy = await svc.getToolPolicy('unknown-tool', 'user-1');

    expect(policy).toBe('prompt');
  });

  it('uses "default" userId when none provided', async () => {
    mockGetPolicy.mockResolvedValue(null);

    const svc = new CliToolService();
    await svc.getToolPolicy('eslint');

    expect(mockGetPolicy).toHaveBeenCalledWith('eslint', 'default');
  });
});

// =============================================================================
// setToolPolicy
// =============================================================================

describe('setToolPolicy', () => {
  it('calls cliToolPoliciesRepo.setPolicy with the correct arguments', async () => {
    const svc = new CliToolService();
    await svc.setToolPolicy('eslint', 'blocked', 'user-1');

    expect(mockSetPolicy).toHaveBeenCalledWith('eslint', 'blocked', 'user-1');
  });

  it('uses "default" userId when none provided', async () => {
    const svc = new CliToolService();
    await svc.setToolPolicy('prettier', 'allowed');

    expect(mockSetPolicy).toHaveBeenCalledWith('prettier', 'allowed', 'default');
  });

  it('propagates rejection from setPolicy', async () => {
    mockSetPolicy.mockRejectedValue(new Error('DB error'));

    const svc = new CliToolService();
    await expect(svc.setToolPolicy('eslint', 'allowed', 'user-1')).rejects.toThrow('DB error');
  });
});

// =============================================================================
// refreshDiscovery
// =============================================================================

describe('refreshDiscovery', () => {
  it('calls clearDiscoveryCache with no arguments', async () => {
    const svc = new CliToolService();
    await svc.refreshDiscovery();

    expect(mockClearDiscoveryCache).toHaveBeenCalledTimes(1);
    expect(mockClearDiscoveryCache).toHaveBeenCalledWith();
  });
});

// =============================================================================
// getCliToolService — singleton
// =============================================================================

describe('getCliToolService', () => {
  it('returns a CliToolService instance', () => {
    const svc = getCliToolService();
    expect(svc).toBeInstanceOf(CliToolService);
  });

  it('returns the same instance on repeated calls (singleton)', () => {
    const a = getCliToolService();
    const b = getCliToolService();
    expect(a).toBe(b);
  });
});
