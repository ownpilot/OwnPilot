/**
 * CLI Tools Discovery Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockListPolicies, mockListActive, mockIsBinaryInstalled, mockGetBinaryVersion } =
  vi.hoisted(() => ({
    mockListPolicies: vi.fn(),
    mockListActive: vi.fn(),
    mockIsBinaryInstalled: vi.fn(),
    mockGetBinaryVersion: vi.fn(),
  }));

vi.mock('./cli-tools-catalog.js', () => ({
  CLI_TOOLS_CATALOG: [
    {
      name: 'eslint',
      displayName: 'ESLint',
      binaryName: 'eslint',
      category: 'linting',
      riskLevel: 'low',
      defaultPolicy: 'allow',
      npxPackage: 'eslint',
      versionFlag: '--version',
    },
    {
      name: 'prettier',
      displayName: 'Prettier',
      binaryName: 'prettier',
      category: 'formatting',
      riskLevel: 'low',
      defaultPolicy: 'allow',
      npxPackage: 'prettier',
      versionFlag: '--version',
    },
  ],
  CLI_TOOLS_BY_NAME: new Map([
    ['eslint', true],
    ['prettier', true],
  ]),
}));

vi.mock('../db/repositories/cli-tool-policies.js', () => ({
  cliToolPoliciesRepo: {
    listPolicies: (...args: unknown[]) => mockListPolicies(...args),
  },
}));

vi.mock('../db/repositories/cli-providers.js', () => ({
  cliProvidersRepo: {
    listActive: (...args: unknown[]) => mockListActive(...args),
  },
}));

vi.mock('./binary-utils.js', () => ({
  isBinaryInstalled: (...args: unknown[]) => mockIsBinaryInstalled(...args),
  getBinaryVersion: (...args: unknown[]) => mockGetBinaryVersion(...args),
}));

vi.mock('./log.js', () => ({
  getLog: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() })),
}));

import { discoverTools, clearDiscoveryCache } from './cli-tools-discovery.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  clearDiscoveryCache(); // clear module-level cache between tests

  // Default: no policies, no custom providers
  mockListPolicies.mockResolvedValue([]);
  mockListActive.mockResolvedValue([]);
  // Default: binaries not installed
  mockIsBinaryInstalled.mockReturnValue(false);
  mockGetBinaryVersion.mockReturnValue(undefined);
});

describe('discoverTools', () => {
  it('returns catalog tools with not-installed status', async () => {
    const tools = await discoverTools('user-1');
    expect(tools).toHaveLength(2);
    expect(tools[0]!.name).toBe('eslint');
    expect(tools[0]!.installed).toBe(false);
    expect(tools[0]!.version).toBeUndefined();
    expect(tools[0]!.source).toBe('catalog');
  });

  it('returns installed status and version when binary is found', async () => {
    mockIsBinaryInstalled.mockImplementation((bin: string) => bin === 'eslint');
    mockGetBinaryVersion.mockImplementation((bin: string) =>
      bin === 'eslint' ? 'v8.0.0' : undefined
    );

    const tools = await discoverTools('user-1');
    const eslint = tools.find((t) => t.name === 'eslint')!;
    expect(eslint.installed).toBe(true);
    expect(eslint.version).toBe('v8.0.0');
  });

  it('sets npxAvailable when binary not installed but npx exists and has npxPackage', async () => {
    mockIsBinaryInstalled.mockImplementation((bin: string) => bin === 'npx');

    const tools = await discoverTools('user-1');
    const eslint = tools.find((t) => t.name === 'eslint')!;
    expect(eslint.installed).toBe(false);
    expect(eslint.npxAvailable).toBe(true);
  });

  it('npxAvailable is false when npx not found', async () => {
    mockIsBinaryInstalled.mockReturnValue(false);

    const tools = await discoverTools('user-1');
    const eslint = tools.find((t) => t.name === 'eslint')!;
    expect(eslint.npxAvailable).toBe(false);
  });

  it('applies user policy from DB when available', async () => {
    mockListPolicies.mockResolvedValue([{ toolName: 'eslint', policy: 'deny' }]);

    const tools = await discoverTools('user-1');
    const eslint = tools.find((t) => t.name === 'eslint')!;
    expect(eslint.policy).toBe('deny');
  });

  it('falls back to catalog defaultPolicy when no user policy', async () => {
    mockListPolicies.mockResolvedValue([]);

    const tools = await discoverTools('user-1');
    const eslint = tools.find((t) => t.name === 'eslint')!;
    expect(eslint.policy).toBe('allow'); // catalogEntry.defaultPolicy
  });

  it('returns cached result on second call (same userId)', async () => {
    await discoverTools('user-1');
    await discoverTools('user-1');

    // listPolicies should only be called once (second call uses cache)
    expect(mockListPolicies).toHaveBeenCalledTimes(1);
  });

  it('bypasses cache when forceRefresh=true', async () => {
    await discoverTools('user-1');
    await discoverTools('user-1', true);

    expect(mockListPolicies).toHaveBeenCalledTimes(2);
  });

  it('uses separate cache per userId', async () => {
    await discoverTools('user-1');
    await discoverTools('user-2');

    expect(mockListPolicies).toHaveBeenCalledTimes(2);
  });

  it('returns catalog tools when policies DB throws', async () => {
    mockListPolicies.mockRejectedValue(new Error('DB not ready'));

    const tools = await discoverTools('user-1');
    expect(tools).toHaveLength(2); // catalog tools still returned
    // falls back to defaultPolicy
    expect(tools[0]!.policy).toBe('allow');
  });

  it('includes custom providers from DB', async () => {
    mockListActive.mockResolvedValue([
      {
        name: 'mytool',
        displayName: 'My Tool',
        binary: 'mytool',
        category: 'utility',
      },
    ]);
    mockIsBinaryInstalled.mockImplementation((bin: string) => bin === 'mytool');
    mockGetBinaryVersion.mockImplementation((bin: string) =>
      bin === 'mytool' ? '1.0.0' : undefined
    );

    const tools = await discoverTools('user-1');
    const custom = tools.find((t) => t.name === 'custom:mytool')!;
    expect(custom).toBeDefined();
    expect(custom.source).toBe('custom');
    expect(custom.installed).toBe(true);
    expect(custom.version).toBe('1.0.0');
    expect(custom.riskLevel).toBe('medium');
    expect(custom.npxAvailable).toBe(false);
  });

  it('skips custom provider when name collides with catalog', async () => {
    mockListActive.mockResolvedValue([
      {
        name: 'eslint', // same as catalog entry
        displayName: 'Custom ESLint',
        binary: 'eslint',
        category: 'linting',
      },
    ]);

    const tools = await discoverTools('user-1');
    // Should still be 2 tools (catalog), not 3
    expect(tools).toHaveLength(2);
    // The catalog version should be present, not custom
    expect(tools.every((t) => t.source === 'catalog')).toBe(true);
  });

  it('falls back to catalog-only when custom providers DB throws', async () => {
    mockListActive.mockRejectedValue(new Error('DB not ready'));

    const tools = await discoverTools('user-1');
    expect(tools).toHaveLength(2); // only catalog
    expect(tools.every((t) => t.source === 'catalog')).toBe(true);
  });

  it('applies custom provider policy from policyMap', async () => {
    mockListActive.mockResolvedValue([
      { name: 'mytool', displayName: 'My Tool', binary: 'mytool', category: 'utility' },
    ]);
    mockListPolicies.mockResolvedValue([{ toolName: 'custom:mytool', policy: 'deny' }]);

    const tools = await discoverTools('user-1');
    const custom = tools.find((t) => t.name === 'custom:mytool')!;
    expect(custom.policy).toBe('deny');
  });

  it('defaults custom provider policy to "prompt" when no policy set', async () => {
    mockListActive.mockResolvedValue([
      { name: 'mytool', displayName: 'My Tool', binary: 'mytool', category: 'utility' },
    ]);

    const tools = await discoverTools('user-1');
    const custom = tools.find((t) => t.name === 'custom:mytool')!;
    expect(custom.policy).toBe('prompt');
  });

  it('uses "utility" as default category for custom provider with no category', async () => {
    mockListActive.mockResolvedValue([
      { name: 'mytool', displayName: 'My Tool', binary: 'mytool', category: null },
    ]);

    const tools = await discoverTools('user-1');
    const custom = tools.find((t) => t.name === 'custom:mytool')!;
    expect(custom.category).toBe('utility');
  });
});

describe('clearDiscoveryCache', () => {
  it('clears cache for specific userId', async () => {
    await discoverTools('user-1');
    clearDiscoveryCache('user-1');
    await discoverTools('user-1');

    // After clearing user-1's cache, discovery runs again
    expect(mockListPolicies).toHaveBeenCalledTimes(2);
  });

  it('does not clear other users cache when specific userId given', async () => {
    await discoverTools('user-1');
    await discoverTools('user-2');
    clearDiscoveryCache('user-1');
    await discoverTools('user-2'); // should use cache

    expect(mockListPolicies).toHaveBeenCalledTimes(2); // user-1 twice, user-2 once
  });

  it('clears all user caches when no userId given', async () => {
    await discoverTools('user-1');
    await discoverTools('user-2');
    clearDiscoveryCache(); // clear all
    await discoverTools('user-1');
    await discoverTools('user-2');

    expect(mockListPolicies).toHaveBeenCalledTimes(4);
  });
});
