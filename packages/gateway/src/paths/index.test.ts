/**
 * Comprehensive tests for packages/gateway/src/paths/index.ts
 *
 * Covers: getDataPaths, getDataPath, getWorkspacePath, getDatabasePath,
 * initializeDataDirectories, areDataDirectoriesInitialized, getLegacyDataPath,
 * hasLegacyData, getDataDirectoryInfo, setDataPathEnvironment.
 *
 * The module-level `cachedPaths` variable is reset between tests via
 * vi.resetModules() + dynamic import through the `freshModule()` helper.
 *
 * KEY DESIGN: mockHomedir and mockPlatform are hoisted so the same vi.fn()
 * reference is reused by every vi.mock() factory call (including those triggered
 * by vi.resetModules()). Without hoisting, resetModules() would cause the factory
 * to create new vi.fn() instances — meaning calls to mockReturnValue made before
 * freshModule() would operate on stale references the module never sees.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Hoisted mocks — same reference reused across all vi.resetModules() calls
// ============================================================================

const { mockExistsSync, mockMkdirSync, mockChmodSync, mockLog, mockHomedir, mockPlatform } =
  vi.hoisted(() => ({
    mockExistsSync: vi.fn(() => false),
    mockMkdirSync: vi.fn(),
    mockChmodSync: vi.fn(),
    mockLog: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    mockHomedir: vi.fn(() => '/home/testuser'),
    mockPlatform: vi.fn(() => 'linux'),
  }));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  chmodSync: mockChmodSync,
}));

vi.mock('node:os', () => ({
  homedir: mockHomedir,
  platform: mockPlatform,
}));

vi.mock('node:path', () => ({
  // Simplified join/resolve using forward slashes consistently across platforms.
  join: (...args: string[]) => args.filter(Boolean).join('/'),
  resolve: (...args: string[]) => args.filter(Boolean).join('/'),
}));

vi.mock('../services/log.js', () => ({
  getLog: vi.fn(() => mockLog),
}));

// ============================================================================
// Helper: reset module registry (clears cachedPaths) then re-import
// ============================================================================

async function freshModule() {
  vi.resetModules();
  return import('./index.js');
}

// ============================================================================
// Global setup — runs before every single test
// ============================================================================

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  // clearAllMocks clears call history but NOT mock implementations.
  // We explicitly reset each mock's implementation here so stale overrides
  // (e.g. a test that makes chmodSync throw) do not bleed into the next test.
  vi.clearAllMocks();

  // Reset os mocks to safe defaults
  mockHomedir.mockReturnValue('/home/testuser');
  mockPlatform.mockReturnValue('linux');

  // Reset fs mocks to safe defaults (no throwing implementation)
  mockExistsSync.mockReturnValue(false);
  mockMkdirSync.mockImplementation(() => undefined);
  mockChmodSync.mockImplementation(() => undefined);

  // Snapshot and clean env
  savedEnv = { ...process.env };
  delete process.env.OWNPILOT_DATA_DIR;
  delete process.env.LOCALAPPDATA;
  delete process.env.XDG_DATA_HOME;
  delete process.env.DATA_DIR;
  delete process.env.WORKSPACE_DIR;
  delete process.env.DATABASE_PATH;
});

afterEach(() => {
  process.env = savedEnv;
});

// ============================================================================
// getAppDataDir (tested through getDataPaths)
// ============================================================================

describe('getAppDataDir() — via getDataPaths()', () => {
  describe('OWNPILOT_DATA_DIR override', () => {
    it('uses OWNPILOT_DATA_DIR when set', async () => {
      process.env.OWNPILOT_DATA_DIR = '/custom/data/dir';
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toBe('/custom/data/dir');
    });

    it('ignores platform when OWNPILOT_DATA_DIR is set', async () => {
      mockPlatform.mockReturnValue('win32');
      process.env.OWNPILOT_DATA_DIR = '/override/path';
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toBe('/override/path');
    });

    it('uses env value as-is through resolve()', async () => {
      process.env.OWNPILOT_DATA_DIR = '/my/custom/ownpilot';
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toContain('my/custom/ownpilot');
    });
  });

  describe('Windows (win32)', () => {
    beforeEach(() => {
      mockPlatform.mockReturnValue('win32');
      mockHomedir.mockReturnValue('/home/testuser');
    });

    it('uses LOCALAPPDATA/OwnPilot when LOCALAPPDATA is set', async () => {
      process.env.LOCALAPPDATA = 'C:/Users/testuser/AppData/Local';
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toBe('C:/Users/testuser/AppData/Local/OwnPilot');
    });

    it('falls back to homedir/AppData/Local/OwnPilot when LOCALAPPDATA not set', async () => {
      delete process.env.LOCALAPPDATA;
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toBe('/home/testuser/AppData/Local/OwnPilot');
    });

    it('root contains OwnPilot', async () => {
      process.env.LOCALAPPDATA = 'C:/AppData/Local';
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toContain('OwnPilot');
    });

    it('does not use .local or .ownpilot paths on win32', async () => {
      process.env.LOCALAPPDATA = 'C:/AppData/Local';
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).not.toContain('.local');
      expect(paths.root).not.toContain('.ownpilot');
    });
  });

  describe('macOS (darwin)', () => {
    beforeEach(() => {
      mockPlatform.mockReturnValue('darwin');
      mockHomedir.mockReturnValue('/home/testuser');
    });

    it('uses ~/Library/Application Support/OwnPilot', async () => {
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toBe('/home/testuser/Library/Application Support/OwnPilot');
    });

    it('root includes a custom homedir value', async () => {
      mockHomedir.mockReturnValue('/Users/alice');
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toContain('/Users/alice');
    });

    it('root includes Application Support', async () => {
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toContain('Application Support');
    });

    it('root ends with OwnPilot', async () => {
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root.endsWith('OwnPilot')).toBe(true);
    });
  });

  describe('Linux — with .local directory', () => {
    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
      mockHomedir.mockReturnValue('/home/testuser');
      // .local exists → XDG branch taken
      mockExistsSync.mockImplementation((p: string) => p === '/home/testuser/.local');
    });

    it('uses ~/.local/share/ownpilot when .local exists', async () => {
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toBe('/home/testuser/.local/share/ownpilot');
    });

    it('checks existsSync for the .local directory', async () => {
      const { getDataPaths } = await freshModule();
      getDataPaths();
      expect(mockExistsSync).toHaveBeenCalledWith('/home/testuser/.local');
    });

    it('does not fall back to .ownpilot when .local exists', async () => {
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).not.toContain('.ownpilot');
    });
  });

  describe('Linux — with XDG_DATA_HOME set', () => {
    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
      mockHomedir.mockReturnValue('/home/testuser');
      process.env.XDG_DATA_HOME = '/custom/xdg/share';
      // .local must exist for the XDG branch to activate
      mockExistsSync.mockImplementation((p: string) => p === '/home/testuser/.local');
    });

    it('uses XDG_DATA_HOME/ownpilot when XDG_DATA_HOME is set and .local exists', async () => {
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toBe('/custom/xdg/share/ownpilot');
    });

    it('root ends with ownpilot suffix', async () => {
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root.endsWith('ownpilot')).toBe(true);
    });
  });

  describe('Linux — without .local directory', () => {
    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
      mockHomedir.mockReturnValue('/home/testuser');
      mockExistsSync.mockReturnValue(false); // .local does not exist
    });

    it('falls back to ~/.ownpilot when .local does not exist', async () => {
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toBe('/home/testuser/.ownpilot');
    });

    it('does not include .local in root', async () => {
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).not.toContain('.local');
    });

    it('uses homedir in fallback path', async () => {
      mockHomedir.mockReturnValue('/home/bob');
      const { getDataPaths } = await freshModule();
      const paths = getDataPaths();
      expect(paths.root).toContain('/home/bob');
    });
  });
});

// ============================================================================
// getDataPaths() — structure and caching
// ============================================================================

describe('getDataPaths()', () => {
  // All tests in this group use Linux + .local so we get a predictable root.
  beforeEach(() => {
    mockPlatform.mockReturnValue('linux');
    mockHomedir.mockReturnValue('/home/testuser');
    mockExistsSync.mockImplementation((p: string) => p === '/home/testuser/.local');
  });

  it('returns an object with all required DataPaths keys', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    const expectedKeys: Array<keyof typeof paths> = [
      'root',
      'config',
      'data',
      'credentials',
      'personal',
      'workspace',
      'logs',
      'cache',
      'scripts',
      'output',
      'temp',
      'downloads',
      'database',
    ];
    for (const key of expectedKeys) {
      expect(paths).toHaveProperty(key);
      expect(typeof paths[key]).toBe('string');
    }
  });

  it('root is the XDG ownpilot directory on linux with .local', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.root).toBe('/home/testuser/.local/share/ownpilot');
  });

  it('config is root/config', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.config).toBe(`${paths.root}/config`);
  });

  it('data is root/data', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.data).toBe(`${paths.root}/data`);
  });

  it('credentials is root/credentials', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.credentials).toBe(`${paths.root}/credentials`);
  });

  it('personal is root/personal', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.personal).toBe(`${paths.root}/personal`);
  });

  it('workspace is root/workspace', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.workspace).toBe(`${paths.root}/workspace`);
  });

  it('logs is root/logs', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.logs).toBe(`${paths.root}/logs`);
  });

  it('cache is root/cache', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.cache).toBe(`${paths.root}/cache`);
  });

  it('scripts is root/workspace/scripts', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.scripts).toBe(`${paths.root}/workspace/scripts`);
  });

  it('output is root/workspace/output', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.output).toBe(`${paths.root}/workspace/output`);
  });

  it('temp is root/workspace/temp', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.temp).toBe(`${paths.root}/workspace/temp`);
  });

  it('downloads is root/workspace/downloads', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.downloads).toBe(`${paths.root}/workspace/downloads`);
  });

  it('database is root/data/gateway.db', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.database).toBe(`${paths.root}/data/gateway.db`);
  });

  it('database ends with gateway.db', async () => {
    const { getDataPaths } = await freshModule();
    const paths = getDataPaths();
    expect(paths.database.endsWith('gateway.db')).toBe(true);
  });

  it('caches result — second call returns the exact same object reference', async () => {
    const { getDataPaths } = await freshModule();
    const first = getDataPaths();
    const second = getDataPaths();
    expect(second).toBe(first);
  });

  it('second call does not invoke existsSync again (uses cache)', async () => {
    const { getDataPaths } = await freshModule();
    getDataPaths(); // populates cache
    const callsAfterFirst = mockExistsSync.mock.calls.length;
    getDataPaths(); // should use cache, no new existsSync calls
    const callsAfterSecond = mockExistsSync.mock.calls.length;
    expect(callsAfterSecond - callsAfterFirst).toBe(0);
  });
});

// ============================================================================
// getDataPath()
// ============================================================================

describe('getDataPath()', () => {
  beforeEach(() => {
    mockPlatform.mockReturnValue('linux');
    mockHomedir.mockReturnValue('/home/testuser');
    mockExistsSync.mockImplementation((p: string) => p === '/home/testuser/.local');
  });

  it("returns root for type 'root'", async () => {
    const { getDataPath, getDataPaths } = await freshModule();
    expect(getDataPath('root')).toBe(getDataPaths().root);
  });

  it("returns config for type 'config'", async () => {
    const { getDataPath, getDataPaths } = await freshModule();
    expect(getDataPath('config')).toBe(getDataPaths().config);
  });

  it("returns data for type 'data'", async () => {
    const { getDataPath, getDataPaths } = await freshModule();
    expect(getDataPath('data')).toBe(getDataPaths().data);
  });

  it("returns credentials for type 'credentials'", async () => {
    const { getDataPath, getDataPaths } = await freshModule();
    expect(getDataPath('credentials')).toBe(getDataPaths().credentials);
  });

  it("returns personal for type 'personal'", async () => {
    const { getDataPath, getDataPaths } = await freshModule();
    expect(getDataPath('personal')).toBe(getDataPaths().personal);
  });

  it("returns workspace for type 'workspace'", async () => {
    const { getDataPath, getDataPaths } = await freshModule();
    expect(getDataPath('workspace')).toBe(getDataPaths().workspace);
  });

  it("returns logs for type 'logs'", async () => {
    const { getDataPath, getDataPaths } = await freshModule();
    expect(getDataPath('logs')).toBe(getDataPaths().logs);
  });

  it("returns cache for type 'cache'", async () => {
    const { getDataPath, getDataPaths } = await freshModule();
    expect(getDataPath('cache')).toBe(getDataPaths().cache);
  });

  it('returns a non-empty string for every DataDirType', async () => {
    const { getDataPath } = await freshModule();
    const types = [
      'root',
      'config',
      'data',
      'credentials',
      'personal',
      'workspace',
      'logs',
      'cache',
    ] as const;
    for (const type of types) {
      const result = getDataPath(type);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// getWorkspacePath()
// ============================================================================

describe('getWorkspacePath()', () => {
  beforeEach(() => {
    mockPlatform.mockReturnValue('linux');
    mockHomedir.mockReturnValue('/home/testuser');
    mockExistsSync.mockImplementation((p: string) => p === '/home/testuser/.local');
  });

  it("returns scripts path for subdir 'scripts'", async () => {
    const { getWorkspacePath, getDataPaths } = await freshModule();
    expect(getWorkspacePath('scripts')).toBe(getDataPaths().scripts);
  });

  it("returns output path for subdir 'output'", async () => {
    const { getWorkspacePath, getDataPaths } = await freshModule();
    expect(getWorkspacePath('output')).toBe(getDataPaths().output);
  });

  it("returns temp path for subdir 'temp'", async () => {
    const { getWorkspacePath, getDataPaths } = await freshModule();
    expect(getWorkspacePath('temp')).toBe(getDataPaths().temp);
  });

  it("returns downloads path for subdir 'downloads'", async () => {
    const { getWorkspacePath, getDataPaths } = await freshModule();
    expect(getWorkspacePath('downloads')).toBe(getDataPaths().downloads);
  });

  it('scripts path contains workspace segment', async () => {
    const { getWorkspacePath } = await freshModule();
    expect(getWorkspacePath('scripts')).toContain('workspace');
  });

  it('all workspace subdirs are nested under the workspace root', async () => {
    const { getWorkspacePath, getDataPaths } = await freshModule();
    const workspaceRoot = getDataPaths().workspace;
    const subdirs = ['scripts', 'output', 'temp', 'downloads'] as const;
    for (const subdir of subdirs) {
      expect(getWorkspacePath(subdir)).toContain(workspaceRoot);
    }
  });
});

// ============================================================================
// getDatabasePath()
// ============================================================================

describe('getDatabasePath()', () => {
  beforeEach(() => {
    mockPlatform.mockReturnValue('linux');
    mockHomedir.mockReturnValue('/home/testuser');
    mockExistsSync.mockImplementation((p: string) => p === '/home/testuser/.local');
  });

  it('returns the database path', async () => {
    const { getDatabasePath, getDataPaths } = await freshModule();
    expect(getDatabasePath()).toBe(getDataPaths().database);
  });

  it('returned path ends with gateway.db', async () => {
    const { getDatabasePath } = await freshModule();
    expect(getDatabasePath().endsWith('gateway.db')).toBe(true);
  });

  it('returned path contains data segment', async () => {
    const { getDatabasePath } = await freshModule();
    expect(getDatabasePath()).toContain('data');
  });
});

// ============================================================================
// initializeDataDirectories()
// ============================================================================

describe('initializeDataDirectories()', () => {
  // Use Linux + .local so ROOT is predictable
  const ROOT = '/home/testuser/.local/share/ownpilot';

  beforeEach(() => {
    mockPlatform.mockReturnValue('linux');
    mockHomedir.mockReturnValue('/home/testuser');
    // .local exists for getAppDataDir; all data dirs do NOT exist → will be created
    mockExistsSync.mockImplementation((p: string) => p === '/home/testuser/.local');
  });

  it('returns a DataPaths object with root, database, and workspace', async () => {
    const { initializeDataDirectories } = await freshModule();
    const result = initializeDataDirectories();
    expect(result).toHaveProperty('root');
    expect(result).toHaveProperty('database');
    expect(result).toHaveProperty('workspace');
  });

  it('calls mkdirSync for the root directory', async () => {
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    expect(mockMkdirSync).toHaveBeenCalledWith(ROOT, { recursive: true });
  });

  it('calls mkdirSync with { recursive: true } for every directory', async () => {
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    for (const call of mockMkdirSync.mock.calls) {
      expect(call[1]).toEqual({ recursive: true });
    }
  });

  it('creates all 12 expected directories when none exist', async () => {
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    // root, config, data, credentials, personal, workspace, logs,
    // cache, scripts, output, temp, downloads
    expect(mockMkdirSync).toHaveBeenCalledTimes(12);
  });

  it('skips existing directories — does not call mkdirSync for them', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/home/testuser/.local') return true;
      if (p === ROOT) return true; // root already exists
      return false;
    });
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    // 11 remaining dirs created (root skipped)
    expect(mockMkdirSync).toHaveBeenCalledTimes(11);
    expect(mockMkdirSync).not.toHaveBeenCalledWith(ROOT, expect.anything());
  });

  it('skips all mkdirSync calls when every directory already exists', async () => {
    mockExistsSync.mockReturnValue(true); // everything exists
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it('calls chmodSync on credentials directory on Linux', async () => {
    const { initializeDataDirectories, getDataPaths } = await freshModule();
    initializeDataDirectories();
    const credentialsPath = getDataPaths().credentials;
    expect(mockChmodSync).toHaveBeenCalledWith(credentialsPath, 0o700);
  });

  it('calls chmodSync exactly once (credentials only)', async () => {
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    expect(mockChmodSync).toHaveBeenCalledTimes(1);
  });

  it('does NOT call chmodSync on Windows', async () => {
    mockPlatform.mockReturnValue('win32');
    mockHomedir.mockReturnValue('/home/testuser');
    process.env.LOCALAPPDATA = 'C:/AppData/Local';
    mockExistsSync.mockReturnValue(false); // no dirs pre-exist
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    expect(mockChmodSync).not.toHaveBeenCalled();
  });

  it('calls chmodSync on credentials directory on macOS (Unix-like)', async () => {
    // The source uses platform() !== 'win32', so darwin is treated like Linux.
    mockPlatform.mockReturnValue('darwin');
    mockHomedir.mockReturnValue('/home/testuser');
    mockExistsSync.mockReturnValue(false); // no dirs pre-exist
    const { initializeDataDirectories, getDataPaths } = await freshModule();
    initializeDataDirectories();
    const credentialsPath = getDataPaths().credentials;
    expect(mockChmodSync).toHaveBeenCalledWith(credentialsPath, 0o700);
  });

  it('handles chmodSync errors gracefully without throwing', async () => {
    mockChmodSync.mockImplementation(() => {
      throw new Error('EPERM: operation not permitted');
    });
    const { initializeDataDirectories } = await freshModule();
    expect(() => initializeDataDirectories()).not.toThrow();
  });

  it('logs each created directory via log.info', async () => {
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    const infoCalls = mockLog.info.mock.calls.map((c: unknown[]) => String(c[0]));
    const createLogs = infoCalls.filter((msg: string) => msg.includes('Created directory'));
    expect(createLogs.length).toBe(12);
  });

  it('logs the data root path at the end', async () => {
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    const infoCalls = mockLog.info.mock.calls.map((c: unknown[]) => String(c[0]));
    const rootLog = infoCalls.find(
      (msg: string) => msg.includes('Data root') && msg.includes(ROOT)
    );
    expect(rootLog).toBeDefined();
  });

  it('does not log Created directory when directories already exist', async () => {
    mockExistsSync.mockReturnValue(true); // all exist
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    const infoCalls = mockLog.info.mock.calls.map((c: unknown[]) => String(c[0]));
    const createLogs = infoCalls.filter((msg: string) => msg.includes('Created directory'));
    expect(createLogs.length).toBe(0);
  });

  it('logs restricted permissions set on credentials (Linux)', async () => {
    const { initializeDataDirectories } = await freshModule();
    initializeDataDirectories();
    const infoCalls = mockLog.info.mock.calls.map((c: unknown[]) => String(c[0]));
    const permLog = infoCalls.find((msg: string) => msg.includes('restricted permissions'));
    expect(permLog).toBeDefined();
  });

  it('applies chmod 0o700 only on the credentials directory', async () => {
    const { initializeDataDirectories, getDataPaths } = await freshModule();
    initializeDataDirectories();
    const credentialsPath = getDataPaths().credentials;
    for (const [path] of mockChmodSync.mock.calls) {
      expect(path).toBe(credentialsPath);
    }
  });
});

// ============================================================================
// areDataDirectoriesInitialized()
// ============================================================================

describe('areDataDirectoriesInitialized()', () => {
  // Linux + .local for predictable paths
  const ROOT = '/home/testuser/.local/share/ownpilot';
  const CONFIG = `${ROOT}/config`;
  const DATA = `${ROOT}/data`;
  const WORKSPACE = `${ROOT}/workspace`;

  // Helper: make existsSync return true for .local AND a given set of data dirs
  function makeExistsMock(existing: string[]) {
    return (p: string) => p === '/home/testuser/.local' || existing.includes(p);
  }

  beforeEach(() => {
    mockPlatform.mockReturnValue('linux');
    mockHomedir.mockReturnValue('/home/testuser');
  });

  it('returns true when all four required directories exist', async () => {
    mockExistsSync.mockImplementation(makeExistsMock([ROOT, CONFIG, DATA, WORKSPACE]));
    const { areDataDirectoriesInitialized } = await freshModule();
    expect(areDataDirectoriesInitialized()).toBe(true);
  });

  it('returns false when root does not exist', async () => {
    mockExistsSync.mockImplementation(makeExistsMock([CONFIG, DATA, WORKSPACE]));
    const { areDataDirectoriesInitialized } = await freshModule();
    expect(areDataDirectoriesInitialized()).toBe(false);
  });

  it('returns false when config does not exist', async () => {
    mockExistsSync.mockImplementation(makeExistsMock([ROOT, DATA, WORKSPACE]));
    const { areDataDirectoriesInitialized } = await freshModule();
    expect(areDataDirectoriesInitialized()).toBe(false);
  });

  it('returns false when data does not exist', async () => {
    mockExistsSync.mockImplementation(makeExistsMock([ROOT, CONFIG, WORKSPACE]));
    const { areDataDirectoriesInitialized } = await freshModule();
    expect(areDataDirectoriesInitialized()).toBe(false);
  });

  it('returns false when workspace does not exist', async () => {
    mockExistsSync.mockImplementation(makeExistsMock([ROOT, CONFIG, DATA]));
    const { areDataDirectoriesInitialized } = await freshModule();
    expect(areDataDirectoriesInitialized()).toBe(false);
  });

  it('returns false when none of the required dirs exist', async () => {
    mockExistsSync.mockImplementation(makeExistsMock([]));
    const { areDataDirectoriesInitialized } = await freshModule();
    expect(areDataDirectoriesInitialized()).toBe(false);
  });

  it('checks root, config, data, and workspace with existsSync', async () => {
    mockExistsSync.mockImplementation(makeExistsMock([ROOT, CONFIG, DATA, WORKSPACE]));
    const { areDataDirectoriesInitialized } = await freshModule();
    areDataDirectoriesInitialized();
    const checkedPaths = mockExistsSync.mock.calls.map((c: unknown[]) => c[0]);
    expect(checkedPaths).toContain(ROOT);
    expect(checkedPaths).toContain(CONFIG);
    expect(checkedPaths).toContain(DATA);
    expect(checkedPaths).toContain(WORKSPACE);
  });

  it('returns a boolean', async () => {
    mockExistsSync.mockImplementation(makeExistsMock([]));
    const { areDataDirectoriesInitialized } = await freshModule();
    expect(typeof areDataDirectoriesInitialized()).toBe('boolean');
  });
});

// ============================================================================
// getLegacyDataPath()
// ============================================================================

describe('getLegacyDataPath()', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
  });

  it('includes data in the returned path', async () => {
    const { getLegacyDataPath } = await freshModule();
    const result = getLegacyDataPath();
    expect(result).toContain('data');
  });

  it('includes process.cwd() in the result', async () => {
    const { getLegacyDataPath } = await freshModule();
    const result = getLegacyDataPath();
    expect(result).toContain(process.cwd());
  });

  it('ends with the data segment', async () => {
    const { getLegacyDataPath } = await freshModule();
    const result = getLegacyDataPath();
    expect(result.endsWith('data')).toBe(true);
  });

  it('returns a string', async () => {
    const { getLegacyDataPath } = await freshModule();
    expect(typeof getLegacyDataPath()).toBe('string');
  });

  it('returns the same value on every call', async () => {
    const { getLegacyDataPath } = await freshModule();
    expect(getLegacyDataPath()).toBe(getLegacyDataPath());
  });
});

// ============================================================================
// hasLegacyData()
// ============================================================================

describe('hasLegacyData()', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
  });

  it('returns false when legacy gateway.db does not exist', async () => {
    const { hasLegacyData } = await freshModule();
    expect(hasLegacyData()).toBe(false);
  });

  it('returns true when legacy gateway.db exists', async () => {
    const { hasLegacyData, getLegacyDataPath } = await freshModule();
    const legacyDb = `${getLegacyDataPath()}/gateway.db`;
    mockExistsSync.mockImplementation((p: string) => p === legacyDb);
    expect(hasLegacyData()).toBe(true);
  });

  it('checks existsSync with the gateway.db path inside the legacy dir', async () => {
    const { hasLegacyData, getLegacyDataPath } = await freshModule();
    const legacyDb = `${getLegacyDataPath()}/gateway.db`;
    mockExistsSync.mockImplementation((p: string) => p === legacyDb);
    hasLegacyData();
    expect(mockExistsSync).toHaveBeenCalledWith(legacyDb);
  });

  it('returns false when only the legacy directory exists (no db file)', async () => {
    const { hasLegacyData, getLegacyDataPath } = await freshModule();
    const legacyDir = getLegacyDataPath();
    mockExistsSync.mockImplementation((p: string) => p === legacyDir);
    expect(hasLegacyData()).toBe(false);
  });

  it('returns a boolean', async () => {
    const { hasLegacyData } = await freshModule();
    expect(typeof hasLegacyData()).toBe('boolean');
  });

  it('is consistent across multiple calls with the same fs state', async () => {
    const { hasLegacyData } = await freshModule();
    mockExistsSync.mockReturnValue(false);
    expect(hasLegacyData()).toBe(false);
    expect(hasLegacyData()).toBe(false);
  });
});

// ============================================================================
// getDataDirectoryInfo()
// ============================================================================

describe('getDataDirectoryInfo()', () => {
  beforeEach(() => {
    mockPlatform.mockReturnValue('linux');
    mockHomedir.mockReturnValue('/home/testuser');
    mockExistsSync.mockImplementation((p: string) => p === '/home/testuser/.local');
  });

  it('returns an object with all six expected keys', async () => {
    const { getDataDirectoryInfo } = await freshModule();
    const info = getDataDirectoryInfo();
    expect(info).toHaveProperty('root');
    expect(info).toHaveProperty('database');
    expect(info).toHaveProperty('workspace');
    expect(info).toHaveProperty('credentials');
    expect(info).toHaveProperty('isDefaultLocation');
    expect(info).toHaveProperty('platform');
  });

  it('root matches getDataPaths().root', async () => {
    const { getDataDirectoryInfo, getDataPaths } = await freshModule();
    expect(getDataDirectoryInfo().root).toBe(getDataPaths().root);
  });

  it('database matches getDataPaths().database', async () => {
    const { getDataDirectoryInfo, getDataPaths } = await freshModule();
    expect(getDataDirectoryInfo().database).toBe(getDataPaths().database);
  });

  it('workspace matches getDataPaths().workspace', async () => {
    const { getDataDirectoryInfo, getDataPaths } = await freshModule();
    expect(getDataDirectoryInfo().workspace).toBe(getDataPaths().workspace);
  });

  it('credentials matches getDataPaths().credentials', async () => {
    const { getDataDirectoryInfo, getDataPaths } = await freshModule();
    expect(getDataDirectoryInfo().credentials).toBe(getDataPaths().credentials);
  });

  it('isDefaultLocation is true when OWNPILOT_DATA_DIR is not set', async () => {
    delete process.env.OWNPILOT_DATA_DIR;
    const { getDataDirectoryInfo } = await freshModule();
    expect(getDataDirectoryInfo().isDefaultLocation).toBe(true);
  });

  it('isDefaultLocation is false when OWNPILOT_DATA_DIR is set', async () => {
    process.env.OWNPILOT_DATA_DIR = '/custom/ownpilot';
    const { getDataDirectoryInfo } = await freshModule();
    expect(getDataDirectoryInfo().isDefaultLocation).toBe(false);
  });

  it('isDefaultLocation is true when OWNPILOT_DATA_DIR is empty string (falsy)', async () => {
    // Empty string is falsy: !'' === true, so isDefaultLocation should be true
    process.env.OWNPILOT_DATA_DIR = '';
    const { getDataDirectoryInfo } = await freshModule();
    expect(getDataDirectoryInfo().isDefaultLocation).toBe(true);
  });

  it('platform returns linux when mocked as linux', async () => {
    const { getDataDirectoryInfo } = await freshModule();
    expect(getDataDirectoryInfo().platform).toBe('linux');
  });

  it('platform returns darwin when mocked as darwin', async () => {
    mockPlatform.mockReturnValue('darwin');
    mockHomedir.mockReturnValue('/home/testuser');
    const { getDataDirectoryInfo } = await freshModule();
    expect(getDataDirectoryInfo().platform).toBe('darwin');
  });

  it('platform returns win32 when mocked as win32', async () => {
    mockPlatform.mockReturnValue('win32');
    mockHomedir.mockReturnValue('/home/testuser');
    process.env.LOCALAPPDATA = 'C:/AppData/Local';
    const { getDataDirectoryInfo } = await freshModule();
    expect(getDataDirectoryInfo().platform).toBe('win32');
  });

  it('all string fields are non-empty', async () => {
    const { getDataDirectoryInfo } = await freshModule();
    const info = getDataDirectoryInfo();
    expect(info.root.length).toBeGreaterThan(0);
    expect(info.database.length).toBeGreaterThan(0);
    expect(info.workspace.length).toBeGreaterThan(0);
    expect(info.credentials.length).toBeGreaterThan(0);
    expect(info.platform.length).toBeGreaterThan(0);
  });

  it('isDefaultLocation is a boolean', async () => {
    const { getDataDirectoryInfo } = await freshModule();
    expect(typeof getDataDirectoryInfo().isDefaultLocation).toBe('boolean');
  });
});

// ============================================================================
// setDataPathEnvironment()
// ============================================================================

describe('setDataPathEnvironment()', () => {
  beforeEach(() => {
    mockPlatform.mockReturnValue('linux');
    mockHomedir.mockReturnValue('/home/testuser');
    mockExistsSync.mockImplementation((p: string) => p === '/home/testuser/.local');
  });

  it('sets DATA_DIR to paths.root', async () => {
    const { setDataPathEnvironment, getDataPaths } = await freshModule();
    setDataPathEnvironment();
    expect(process.env.DATA_DIR).toBe(getDataPaths().root);
  });

  it('sets WORKSPACE_DIR to paths.workspace', async () => {
    const { setDataPathEnvironment, getDataPaths } = await freshModule();
    setDataPathEnvironment();
    expect(process.env.WORKSPACE_DIR).toBe(getDataPaths().workspace);
  });

  it('sets DATABASE_PATH to paths.database', async () => {
    const { setDataPathEnvironment, getDataPaths } = await freshModule();
    setDataPathEnvironment();
    expect(process.env.DATABASE_PATH).toBe(getDataPaths().database);
  });

  it('DATABASE_PATH ends with gateway.db', async () => {
    const { setDataPathEnvironment } = await freshModule();
    setDataPathEnvironment();
    expect(process.env.DATABASE_PATH?.endsWith('gateway.db')).toBe(true);
  });

  it('DATA_DIR matches the XDG root on Linux with .local', async () => {
    const { setDataPathEnvironment } = await freshModule();
    setDataPathEnvironment();
    expect(process.env.DATA_DIR).toBe('/home/testuser/.local/share/ownpilot');
  });

  it('logs the environment configuration header', async () => {
    const { setDataPathEnvironment } = await freshModule();
    setDataPathEnvironment();
    const infoCalls = mockLog.info.mock.calls.map((c: unknown[]) => String(c[0]));
    const headerLog = infoCalls.find((msg: string) => msg.includes('Environment configured'));
    expect(headerLog).toBeDefined();
  });

  it('logs DATA_DIR value', async () => {
    const { setDataPathEnvironment, getDataPaths } = await freshModule();
    setDataPathEnvironment();
    const infoCalls = mockLog.info.mock.calls.map((c: unknown[]) => String(c[0]));
    const dataLog = infoCalls.find(
      (msg: string) => msg.includes('DATA_DIR') && msg.includes(getDataPaths().root)
    );
    expect(dataLog).toBeDefined();
  });

  it('logs WORKSPACE_DIR value', async () => {
    const { setDataPathEnvironment, getDataPaths } = await freshModule();
    setDataPathEnvironment();
    const infoCalls = mockLog.info.mock.calls.map((c: unknown[]) => String(c[0]));
    const wsLog = infoCalls.find(
      (msg: string) => msg.includes('WORKSPACE_DIR') && msg.includes(getDataPaths().workspace)
    );
    expect(wsLog).toBeDefined();
  });

  it('logs DATABASE_PATH value', async () => {
    const { setDataPathEnvironment, getDataPaths } = await freshModule();
    setDataPathEnvironment();
    const infoCalls = mockLog.info.mock.calls.map((c: unknown[]) => String(c[0]));
    const dbLog = infoCalls.find(
      (msg: string) => msg.includes('DATABASE_PATH') && msg.includes(getDataPaths().database)
    );
    expect(dbLog).toBeDefined();
  });

  it('calls log.info exactly 4 times (header + 3 paths)', async () => {
    const { setDataPathEnvironment } = await freshModule();
    setDataPathEnvironment();
    expect(mockLog.info).toHaveBeenCalledTimes(4);
  });

  it('overwrites a previously set DATA_DIR', async () => {
    process.env.DATA_DIR = '/old/data/dir';
    const { setDataPathEnvironment, getDataPaths } = await freshModule();
    setDataPathEnvironment();
    expect(process.env.DATA_DIR).toBe(getDataPaths().root);
    expect(process.env.DATA_DIR).not.toBe('/old/data/dir');
  });

  it('all three env vars are set to non-empty strings', async () => {
    const { setDataPathEnvironment } = await freshModule();
    setDataPathEnvironment();
    expect((process.env.DATA_DIR ?? '').length).toBeGreaterThan(0);
    expect((process.env.WORKSPACE_DIR ?? '').length).toBeGreaterThan(0);
    expect((process.env.DATABASE_PATH ?? '').length).toBeGreaterThan(0);
  });

  it('does not throw when called multiple times', async () => {
    const { setDataPathEnvironment } = await freshModule();
    expect(() => {
      setDataPathEnvironment();
      setDataPathEnvironment();
    }).not.toThrow();
  });
});
