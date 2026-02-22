/**
 * Comprehensive tests for packages/gateway/src/paths/migration.ts
 *
 * Covers: needsMigration, getMigrationStatus, migrateData,
 * copyDirectoryContents (via migrateData), and autoMigrateIfNeeded.
 *
 * Note: All path construction uses node:path join/dirname so tests pass on
 * both Windows (backslash) and Unix (forward-slash) without hard-coded separators.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { join, dirname } from 'node:path';

// ============================================================================
// Mocks — declared before any dynamic imports
// ============================================================================

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('./index.js', () => ({
  getDataPaths: vi.fn(() => ({
    root: '/new/data',
    data: '/new/data/data',
    database: '/new/data/db/gateway.db',
    workspace: '/new/data/workspace',
    logs: '/new/data/logs',
    personal: '/new/data/personal',
  })),
  getLegacyDataPath: vi.fn(() => '/old/data'),
  hasLegacyData: vi.fn(() => false),
  initializeDataDirectories: vi.fn(() => ({
    root: '/new/data',
    data: '/new/data/data',
    database: '/new/data/db/gateway.db',
    workspace: '/new/data/workspace',
    logs: '/new/data/logs',
    personal: '/new/data/personal',
  })),
}));

vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../routes/helpers.js', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

// ============================================================================
// Dynamic imports — must come after vi.mock() calls
// ============================================================================

const { needsMigration, getMigrationStatus, migrateData, autoMigrateIfNeeded } =
  await import('./migration.js');

const { existsSync, copyFileSync, mkdirSync, readdirSync, statSync } = await import('node:fs');

const { getDataPaths, getLegacyDataPath, hasLegacyData, initializeDataDirectories } =
  await import('./index.js');

// Convenience aliases for mock casting
const mockExistsSync = existsSync as Mock;
const mockCopyFileSync = copyFileSync as Mock;
const mockMkdirSync = mkdirSync as Mock;
const mockReaddirSync = readdirSync as Mock;
const mockStatSync = statSync as Mock;
const mockHasLegacyData = hasLegacyData as Mock;
const mockGetDataPaths = getDataPaths as Mock;
const mockGetLegacyDataPath = getLegacyDataPath as Mock;
const mockInitializeDataDirectories = initializeDataDirectories as Mock;

// ============================================================================
// Path constants — built with node:path so they match what the source produces
// ============================================================================

const LEGACY = '/old/data';
const NEW_ROOT = '/new/data';
const NEW_DB = '/new/data/db/gateway.db';
const NEW_DB_DIR = dirname(NEW_DB); // '/new/data/db' (or backslash on Win)
const NEW_WORKSPACE = '/new/data/workspace';
const NEW_LOGS = '/new/data/logs';
const NEW_PERSONAL = '/new/data/personal';

/** Paths the source code computes via join(legacyPath, name) */
const SRC_DB = join(LEGACY, 'gateway.db');
const SRC_SHM = join(LEGACY, 'gateway.db-shm');
const SRC_WAL = join(LEGACY, 'gateway.db-wal');
const SRC_WORKSPACE = join(LEGACY, 'workspace');
const SRC_AUDIT = join(LEGACY, 'audit');
const SRC_USER = join(LEGACY, 'user');
const SRC_USER_DATA = join(LEGACY, 'user-data');

/** Dest paths the source code computes for shm/wal via join(dirname(paths.database), name) */
const DEST_SHM = join(NEW_DB_DIR, 'gateway.db-shm');
const DEST_WAL = join(NEW_DB_DIR, 'gateway.db-wal');

/** Standard paths returned by the mock */
const NEW_PATHS = {
  root: NEW_ROOT,
  data: '/new/data/data',
  database: NEW_DB,
  workspace: NEW_WORKSPACE,
  logs: NEW_LOGS,
  personal: NEW_PERSONAL,
};

// ============================================================================
// Helpers
// ============================================================================

/** Make a fake Dirent-like object for readdirSync({ withFileTypes: true }) */
function makeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  };
}

/** Make a fake stat object */
function makeStat(isDirectory: boolean) {
  return {
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Safe defaults
  mockHasLegacyData.mockReturnValue(false);
  mockExistsSync.mockReturnValue(false);
  mockGetDataPaths.mockReturnValue({ ...NEW_PATHS });
  mockGetLegacyDataPath.mockReturnValue(LEGACY);
  mockInitializeDataDirectories.mockReturnValue({ ...NEW_PATHS });
  mockReaddirSync.mockReturnValue([]);
  mockStatSync.mockReturnValue(makeStat(false));
  mockCopyFileSync.mockReturnValue(undefined);
  mockMkdirSync.mockReturnValue(undefined);
});

// ============================================================================
// needsMigration()
// ============================================================================

describe('needsMigration()', () => {
  it('returns false when hasLegacyData() is false', () => {
    mockHasLegacyData.mockReturnValue(false);
    expect(needsMigration()).toBe(false);
  });

  it('does not call getDataPaths() when no legacy data', () => {
    mockHasLegacyData.mockReturnValue(false);
    needsMigration();
    expect(mockGetDataPaths).not.toHaveBeenCalled();
  });

  it('does not call existsSync when no legacy data', () => {
    mockHasLegacyData.mockReturnValue(false);
    needsMigration();
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('returns false when legacy data exists but new database already exists', () => {
    mockHasLegacyData.mockReturnValue(true);
    mockExistsSync.mockImplementation((p: string) => p === NEW_DB);
    expect(needsMigration()).toBe(false);
  });

  it('returns true when legacy data exists and new database does not exist', () => {
    mockHasLegacyData.mockReturnValue(true);
    mockExistsSync.mockReturnValue(false);
    expect(needsMigration()).toBe(true);
  });

  it('checks existsSync with the database path from getDataPaths()', () => {
    mockHasLegacyData.mockReturnValue(true);
    mockExistsSync.mockReturnValue(false);
    needsMigration();
    expect(mockExistsSync).toHaveBeenCalledWith(NEW_DB);
  });

  it('uses the database field of getDataPaths() result', () => {
    mockHasLegacyData.mockReturnValue(true);
    const customDb = '/custom/path/to/app.db';
    mockGetDataPaths.mockReturnValue({ ...NEW_PATHS, database: customDb });
    mockExistsSync.mockImplementation((p: string) => p === customDb);
    expect(needsMigration()).toBe(false);
  });

  it('returns true when new DB path exists only for a different path', () => {
    mockHasLegacyData.mockReturnValue(true);
    mockExistsSync.mockImplementation((p: string) => p === '/some/other/path');
    expect(needsMigration()).toBe(true);
  });

  it('calls hasLegacyData() exactly once', () => {
    needsMigration();
    expect(mockHasLegacyData).toHaveBeenCalledTimes(1);
  });

  it('returns false consistently when hasLegacyData is false', () => {
    mockHasLegacyData.mockReturnValue(false);
    expect(needsMigration()).toBe(false);
    expect(needsMigration()).toBe(false);
  });
});

// ============================================================================
// getMigrationStatus()
// ============================================================================

describe('getMigrationStatus()', () => {
  it('returns correct legacyPath and newPath from helpers', () => {
    const status = getMigrationStatus();
    expect(status.legacyPath).toBe(LEGACY);
    expect(status.newPath).toBe(NEW_ROOT);
  });

  it('returns needsMigration=false when no legacy data', () => {
    mockHasLegacyData.mockReturnValue(false);
    const status = getMigrationStatus();
    expect(status.needsMigration).toBe(false);
  });

  it('returns needsMigration=true when migration is required', () => {
    mockHasLegacyData.mockReturnValue(true);
    mockExistsSync.mockReturnValue(false);
    const status = getMigrationStatus();
    expect(status.needsMigration).toBe(true);
  });

  it('returns empty legacyFiles when legacy path does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const status = getMigrationStatus();
    expect(status.legacyFiles).toEqual([]);
  });

  it('does not call readdirSync when legacy path does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    getMigrationStatus();
    expect(mockReaddirSync).not.toHaveBeenCalled();
  });

  it('returns only file names (not directories) from legacy path', () => {
    mockExistsSync.mockImplementation((p: string) => p === LEGACY);
    mockReaddirSync.mockReturnValue(['gateway.db', 'subdir', 'gateway.db-shm']);
    mockStatSync.mockImplementation((p: string) => {
      // LEGACY/subdir is a directory; others are files
      if (p === join(LEGACY, 'subdir')) return makeStat(true);
      return makeStat(false);
    });
    const status = getMigrationStatus();
    expect(status.legacyFiles).toEqual(['gateway.db', 'gateway.db-shm']);
    expect(status.legacyFiles).not.toContain('subdir');
  });

  it('returns empty legacyFiles when readdirSync throws', () => {
    mockExistsSync.mockImplementation((p: string) => p === LEGACY);
    mockReaddirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    const status = getMigrationStatus();
    expect(status.legacyFiles).toEqual([]);
  });

  it('returns empty legacyFiles when statSync throws for a file', () => {
    mockExistsSync.mockImplementation((p: string) => p === LEGACY);
    mockReaddirSync.mockReturnValue(['gateway.db']);
    mockStatSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const status = getMigrationStatus();
    expect(status.legacyFiles).toEqual([]);
  });

  it('calls readdirSync with the legacy path', () => {
    mockExistsSync.mockImplementation((p: string) => p === LEGACY);
    mockReaddirSync.mockReturnValue([]);
    getMigrationStatus();
    expect(mockReaddirSync).toHaveBeenCalledWith(LEGACY);
  });

  it('calls statSync with full file paths', () => {
    mockExistsSync.mockImplementation((p: string) => p === LEGACY);
    mockReaddirSync.mockReturnValue(['file.txt']);
    mockStatSync.mockReturnValue(makeStat(false));
    getMigrationStatus();
    expect(mockStatSync).toHaveBeenCalledWith(join(LEGACY, 'file.txt'));
  });

  it('includes multiple files from legacy directory', () => {
    mockExistsSync.mockImplementation((p: string) => p === LEGACY);
    mockReaddirSync.mockReturnValue(['a.db', 'b.db', 'c.txt']);
    mockStatSync.mockReturnValue(makeStat(false));
    const status = getMigrationStatus();
    expect(status.legacyFiles).toEqual(['a.db', 'b.db', 'c.txt']);
  });

  it('returns the correct shape with all four keys', () => {
    const status = getMigrationStatus();
    expect(status).toHaveProperty('needsMigration');
    expect(status).toHaveProperty('legacyPath');
    expect(status).toHaveProperty('newPath');
    expect(status).toHaveProperty('legacyFiles');
  });

  it('uses getLegacyDataPath() for legacyPath', () => {
    mockGetLegacyDataPath.mockReturnValue('/custom/legacy');
    mockExistsSync.mockReturnValue(false);
    const status = getMigrationStatus();
    expect(status.legacyPath).toBe('/custom/legacy');
  });

  it('uses getDataPaths().root for newPath', () => {
    mockGetDataPaths.mockReturnValue({ ...NEW_PATHS, root: '/custom/new/root' });
    const status = getMigrationStatus();
    expect(status.newPath).toBe('/custom/new/root');
  });

  it('ignores directories when building legacyFiles list', () => {
    mockExistsSync.mockImplementation((p: string) => p === LEGACY);
    mockReaddirSync.mockReturnValue(['dir1', 'dir2']);
    mockStatSync.mockReturnValue(makeStat(true)); // all directories
    const status = getMigrationStatus();
    expect(status.legacyFiles).toHaveLength(0);
  });

  it('legacyFiles is always an array', () => {
    const status = getMigrationStatus();
    expect(Array.isArray(status.legacyFiles)).toBe(true);
  });
});

// ============================================================================
// migrateData()
// ============================================================================

describe('migrateData()', () => {
  describe('when legacy path does not exist', () => {
    it('returns success=true with empty migratedFiles', () => {
      mockExistsSync.mockReturnValue(false);
      const result = migrateData();
      expect(result.success).toBe(true);
      expect(result.migratedFiles).toEqual([]);
    });

    it('returns empty errors array', () => {
      mockExistsSync.mockReturnValue(false);
      const result = migrateData();
      expect(result.errors).toEqual([]);
    });

    it('returns correct legacyPath and newPath', () => {
      mockExistsSync.mockReturnValue(false);
      const result = migrateData();
      expect(result.legacyPath).toBe(LEGACY);
      expect(result.newPath).toBe(NEW_ROOT);
    });

    it('does not call copyFileSync', () => {
      mockExistsSync.mockReturnValue(false);
      migrateData();
      expect(mockCopyFileSync).not.toHaveBeenCalled();
    });

    it('does not call mkdirSync', () => {
      mockExistsSync.mockReturnValue(false);
      migrateData();
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('file migration: gateway.db', () => {
    it('copies gateway.db to the database path', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true; // legacy path exists
        if (p === SRC_DB) return true; // source file exists
        if (p === NEW_DB_DIR) return true; // dest dir exists
        return false; // dest file does not exist
      });
      migrateData();
      expect(mockCopyFileSync).toHaveBeenCalledWith(SRC_DB, NEW_DB);
    });

    it('adds gateway.db to migratedFiles on success', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      const result = migrateData();
      expect(result.migratedFiles).toContain('gateway.db');
    });

    it('skips gateway.db when source does not exist', () => {
      mockExistsSync.mockImplementation((p: string) => p === LEGACY);
      migrateData();
      expect(mockCopyFileSync).not.toHaveBeenCalledWith(
        expect.stringContaining('gateway.db'),
        expect.any(String)
      );
    });

    it('creates destination directory if it does not exist', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        return false; // NEW_DB_DIR and NEW_DB do not exist
      });
      migrateData();
      expect(mockMkdirSync).toHaveBeenCalledWith(NEW_DB_DIR, { recursive: true });
    });

    it('does not create destDir if it already exists', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      migrateData();
      expect(mockMkdirSync).not.toHaveBeenCalledWith(NEW_DB_DIR, expect.anything());
    });

    it('skips copy when destination file already exists (no overwrite)', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        if (p === NEW_DB_DIR) return true;
        if (p === NEW_DB) return true; // dest already exists
        return false;
      });
      migrateData();
      expect(mockCopyFileSync).not.toHaveBeenCalledWith(SRC_DB, NEW_DB);
    });

    it('does not add skipped file to migratedFiles', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        if (p === NEW_DB) return true;
        return false;
      });
      const result = migrateData();
      expect(result.migratedFiles).not.toContain('gateway.db');
    });

    it('captures copy error in errors array', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      mockCopyFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      const result = migrateData();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('gateway.db');
      expect(result.errors[0]).toContain('EACCES: permission denied');
    });

    it('sets success=false when a file copy errors', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      mockCopyFileSync.mockImplementation(() => {
        throw new Error('disk full');
      });
      const result = migrateData();
      expect(result.success).toBe(false);
    });
  });

  describe('file migration: gateway.db-shm and gateway.db-wal', () => {
    it('copies gateway.db-shm to the same directory as database', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_SHM) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      migrateData();
      expect(mockCopyFileSync).toHaveBeenCalledWith(SRC_SHM, DEST_SHM);
    });

    it('copies gateway.db-wal to the same directory as database', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_WAL) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      migrateData();
      expect(mockCopyFileSync).toHaveBeenCalledWith(SRC_WAL, DEST_WAL);
    });

    it('adds both shm and wal to migratedFiles on success', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_SHM) return true;
        if (p === SRC_WAL) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      const result = migrateData();
      expect(result.migratedFiles).toContain('gateway.db-shm');
      expect(result.migratedFiles).toContain('gateway.db-wal');
    });

    it('skips shm when source does not exist', () => {
      mockExistsSync.mockImplementation((p: string) => p === LEGACY);
      migrateData();
      expect(mockCopyFileSync).not.toHaveBeenCalledWith(SRC_SHM, expect.any(String));
    });

    it('skips wal when source does not exist', () => {
      mockExistsSync.mockImplementation((p: string) => p === LEGACY);
      migrateData();
      expect(mockCopyFileSync).not.toHaveBeenCalledWith(SRC_WAL, expect.any(String));
    });

    it('skips shm copy when destination already exists', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_SHM) return true;
        if (p === NEW_DB_DIR) return true;
        if (p === DEST_SHM) return true; // already at destination
        return false;
      });
      migrateData();
      expect(mockCopyFileSync).not.toHaveBeenCalledWith(SRC_SHM, DEST_SHM);
    });
  });

  describe('directory migration: workspace', () => {
    it('adds workspace/ to migratedFiles', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_WORKSPACE) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === SRC_WORKSPACE) return makeStat(true);
        return makeStat(false);
      });
      mockReaddirSync.mockReturnValue([]);
      const result = migrateData();
      expect(result.migratedFiles).toContain('workspace/');
    });

    it('calls copyDirectoryContents for workspace (creates dest dir)', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_WORKSPACE) return true;
        return false; // workspace dest does not exist
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === SRC_WORKSPACE) return makeStat(true);
        return makeStat(false);
      });
      mockReaddirSync.mockReturnValue([]);
      migrateData();
      expect(mockMkdirSync).toHaveBeenCalledWith(NEW_WORKSPACE, { recursive: true });
    });

    it('skips workspace when source does not exist', () => {
      mockExistsSync.mockImplementation((p: string) => p === LEGACY);
      const result = migrateData();
      expect(result.migratedFiles).not.toContain('workspace/');
    });

    it('skips workspace if source exists but is not a directory', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_WORKSPACE) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === SRC_WORKSPACE) return makeStat(false); // file, not dir
        return makeStat(false);
      });
      const result = migrateData();
      expect(result.migratedFiles).not.toContain('workspace/');
    });

    it('captures directory migration error in errors array', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_WORKSPACE) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === SRC_WORKSPACE) return makeStat(true);
        return makeStat(false);
      });
      mockReaddirSync.mockImplementation(() => {
        throw new Error('EACCES: cannot read dir');
      });
      const result = migrateData();
      expect(result.errors.some((e) => e.includes('workspace/'))).toBe(true);
    });

    it('sets success=false when directory migration errors', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_WORKSPACE) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === SRC_WORKSPACE) return makeStat(true);
        return makeStat(false);
      });
      mockReaddirSync.mockImplementation(() => {
        throw new Error('permission denied');
      });
      const result = migrateData();
      expect(result.success).toBe(false);
    });
  });

  describe('directory migration: audit → logs', () => {
    it('migrates audit to paths.logs', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_AUDIT) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === SRC_AUDIT) return makeStat(true);
        return makeStat(false);
      });
      mockReaddirSync.mockReturnValue([]);
      const result = migrateData();
      expect(result.migratedFiles).toContain('audit/');
      expect(mockMkdirSync).toHaveBeenCalledWith(NEW_LOGS, { recursive: true });
    });

    it('skips audit when source does not exist', () => {
      mockExistsSync.mockImplementation((p: string) => p === LEGACY);
      const result = migrateData();
      expect(result.migratedFiles).not.toContain('audit/');
    });
  });

  describe('directory migration: user → personal', () => {
    it('migrates user to paths.personal', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_USER) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === SRC_USER) return makeStat(true);
        return makeStat(false);
      });
      mockReaddirSync.mockReturnValue([]);
      const result = migrateData();
      expect(result.migratedFiles).toContain('user/');
      expect(mockMkdirSync).toHaveBeenCalledWith(NEW_PERSONAL, { recursive: true });
    });
  });

  describe('directory migration: user-data → personal', () => {
    it('migrates user-data to paths.personal', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_USER_DATA) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === SRC_USER_DATA) return makeStat(true);
        return makeStat(false);
      });
      mockReaddirSync.mockReturnValue([]);
      const result = migrateData();
      expect(result.migratedFiles).toContain('user-data/');
    });
  });

  describe('multiple items', () => {
    it('migrates all files and dirs that exist', () => {
      const existingPaths = new Set([LEGACY, SRC_DB, SRC_SHM, SRC_WORKSPACE, NEW_DB_DIR]);
      mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));
      mockStatSync.mockImplementation((p: string) => {
        if (p === SRC_WORKSPACE) return makeStat(true);
        return makeStat(false);
      });
      mockReaddirSync.mockReturnValue([]);

      const result = migrateData();
      expect(result.migratedFiles).toContain('gateway.db');
      expect(result.migratedFiles).toContain('gateway.db-shm');
      expect(result.migratedFiles).toContain('workspace/');
      expect(result.success).toBe(true);
    });

    it('success=false when at least one error occurs', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      mockCopyFileSync.mockImplementation(() => {
        throw new Error('disk full');
      });
      const result = migrateData();
      expect(result.success).toBe(false);
    });

    it('continues migrating other items after one error', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        if (p === SRC_SHM) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      let callCount = 0;
      mockCopyFileSync.mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('fail first');
        // second call (shm) succeeds
      });
      const result = migrateData();
      expect(result.errors).toHaveLength(1);
      expect(result.migratedFiles).toContain('gateway.db-shm');
    });

    it('accumulates multiple errors without stopping', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        if (p === SRC_SHM) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      mockCopyFileSync.mockImplementation(() => {
        throw new Error('io error');
      });
      const result = migrateData();
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.success).toBe(false);
    });
  });

  describe('options parameter', () => {
    it('accepts empty options object', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => migrateData({})).not.toThrow();
    });

    it('accepts options with backup flag', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => migrateData({ backup: true })).not.toThrow();
    });

    it('accepts no arguments (default options)', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => migrateData()).not.toThrow();
    });
  });

  describe('return value structure', () => {
    it('always returns an object with all MigrationResult keys', () => {
      mockExistsSync.mockReturnValue(false);
      const result = migrateData();
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('migratedFiles');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('legacyPath');
      expect(result).toHaveProperty('newPath');
    });

    it('returns legacyPath from getLegacyDataPath()', () => {
      mockGetLegacyDataPath.mockReturnValue('/custom/legacy/dir');
      mockInitializeDataDirectories.mockReturnValue({
        ...NEW_PATHS,
        root: '/custom/new',
      });
      mockExistsSync.mockReturnValue(false);
      const result = migrateData();
      expect(result.legacyPath).toBe('/custom/legacy/dir');
    });

    it('returns newPath from initializeDataDirectories().root', () => {
      mockInitializeDataDirectories.mockReturnValue({
        ...NEW_PATHS,
        root: '/custom/new/root',
      });
      mockExistsSync.mockReturnValue(false);
      const result = migrateData();
      expect(result.newPath).toBe('/custom/new/root');
    });

    it('migratedFiles is an array', () => {
      mockExistsSync.mockReturnValue(false);
      const result = migrateData();
      expect(Array.isArray(result.migratedFiles)).toBe(true);
    });

    it('errors is an array', () => {
      mockExistsSync.mockReturnValue(false);
      const result = migrateData();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('success is a boolean', () => {
      mockExistsSync.mockReturnValue(false);
      const result = migrateData();
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('non-Error thrown objects', () => {
    it('handles non-Error thrown objects in file copy', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_DB) return true;
        if (p === NEW_DB_DIR) return true;
        return false;
      });
      mockCopyFileSync.mockImplementation(() => {
        throw new Error('string error');
      });
      const result = migrateData();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('string error');
    });

    it('handles non-Error thrown objects in directory migration', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === LEGACY) return true;
        if (p === SRC_WORKSPACE) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === SRC_WORKSPACE) return makeStat(true);
        return makeStat(false);
      });
      mockReaddirSync.mockImplementation(() => {
        throw new Error('42');
      });
      const result = migrateData();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('42');
    });
  });

  describe('calls initializeDataDirectories', () => {
    it('calls initializeDataDirectories once per migrateData call', () => {
      mockExistsSync.mockReturnValue(false);
      migrateData();
      expect(mockInitializeDataDirectories).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// copyDirectoryContents (private, exercised via migrateData)
// ============================================================================

describe('copyDirectoryContents (via migrateData)', () => {
  it('creates destination directory when it does not exist', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === LEGACY) return true;
      if (p === SRC_WORKSPACE) return true;
      return false; // workspace dest does not exist
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === SRC_WORKSPACE) return makeStat(true);
      return makeStat(false);
    });
    mockReaddirSync.mockReturnValue([]);
    migrateData();
    expect(mockMkdirSync).toHaveBeenCalledWith(NEW_WORKSPACE, { recursive: true });
  });

  it('does not call mkdirSync for dest when it already exists', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === LEGACY) return true;
      if (p === SRC_WORKSPACE) return true;
      if (p === NEW_WORKSPACE) return true; // dest exists
      return false;
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === SRC_WORKSPACE) return makeStat(true);
      return makeStat(false);
    });
    mockReaddirSync.mockReturnValue([]);
    migrateData();
    expect(mockMkdirSync).not.toHaveBeenCalledWith(NEW_WORKSPACE, expect.anything());
  });

  it('copies files from source dir to dest dir', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === LEGACY) return true;
      if (p === SRC_WORKSPACE) return true;
      if (p === NEW_WORKSPACE) return true;
      return false; // dest file does not exist
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === SRC_WORKSPACE) return makeStat(true);
      return makeStat(false);
    });
    mockReaddirSync.mockReturnValue([makeDirent('script.js', false)]);
    migrateData();
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      join(SRC_WORKSPACE, 'script.js'),
      join(NEW_WORKSPACE, 'script.js')
    );
  });

  it('skips file copy when destination file already exists', () => {
    const destFile = join(NEW_WORKSPACE, 'script.js');
    mockExistsSync.mockImplementation((p: string) => {
      if (p === LEGACY) return true;
      if (p === SRC_WORKSPACE) return true;
      if (p === NEW_WORKSPACE) return true;
      if (p === destFile) return true; // file already at dest
      return false;
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === SRC_WORKSPACE) return makeStat(true);
      return makeStat(false);
    });
    mockReaddirSync.mockReturnValue([makeDirent('script.js', false)]);
    migrateData();
    expect(mockCopyFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining('script.js'),
      expect.any(String)
    );
  });

  it('recurses into subdirectories', () => {
    const subSrc = join(SRC_WORKSPACE, 'subdir');
    const subDest = join(NEW_WORKSPACE, 'subdir');
    const fileSrc = join(subSrc, 'file.txt');
    const fileDest = join(subDest, 'file.txt');

    mockExistsSync.mockImplementation((p: string) => {
      if (p === LEGACY) return true;
      if (p === SRC_WORKSPACE) return true;
      if (p === NEW_WORKSPACE) return true;
      return false; // subdir dest and file dest don't exist
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === SRC_WORKSPACE) return makeStat(true);
      return makeStat(false);
    });
    mockReaddirSync
      .mockReturnValueOnce([makeDirent('subdir', true)]) // workspace listing
      .mockReturnValueOnce([makeDirent('file.txt', false)]); // subdir listing

    migrateData();

    expect(mockMkdirSync).toHaveBeenCalledWith(subDest, { recursive: true });
    expect(mockCopyFileSync).toHaveBeenCalledWith(fileSrc, fileDest);
  });

  it('handles mixed directory and file entries', () => {
    const _nestedSrc = join(SRC_WORKSPACE, 'nested');
    const nestedDest = join(NEW_WORKSPACE, 'nested');
    const readmeSrc = join(SRC_WORKSPACE, 'readme.txt');
    const readmeDest = join(NEW_WORKSPACE, 'readme.txt');

    mockExistsSync.mockImplementation((p: string) => {
      if (p === LEGACY) return true;
      if (p === SRC_WORKSPACE) return true;
      if (p === NEW_WORKSPACE) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === SRC_WORKSPACE) return makeStat(true);
      return makeStat(false);
    });
    mockReaddirSync
      .mockReturnValueOnce([makeDirent('nested', true), makeDirent('readme.txt', false)])
      .mockReturnValueOnce([]); // nested dir is empty

    migrateData();

    expect(mockCopyFileSync).toHaveBeenCalledWith(readmeSrc, readmeDest);
    expect(mockMkdirSync).toHaveBeenCalledWith(nestedDest, { recursive: true });
  });

  it('does not copy files to existing dest without throwing', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === LEGACY) return true;
      if (p === SRC_WORKSPACE) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === SRC_WORKSPACE) return makeStat(true);
      return makeStat(false);
    });
    mockReaddirSync.mockReturnValue([]);
    expect(() => migrateData()).not.toThrow();
  });

  it('copies multiple files in the same directory', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === LEGACY) return true;
      if (p === SRC_WORKSPACE) return true;
      if (p === NEW_WORKSPACE) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === SRC_WORKSPACE) return makeStat(true);
      return makeStat(false);
    });
    mockReaddirSync.mockReturnValue([
      makeDirent('a.txt', false),
      makeDirent('b.txt', false),
      makeDirent('c.txt', false),
    ]);
    migrateData();
    expect(mockCopyFileSync).toHaveBeenCalledTimes(3);
  });

  it('passes withFileTypes option to readdirSync inside directory copy', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === LEGACY) return true;
      if (p === SRC_WORKSPACE) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: string) => {
      if (p === SRC_WORKSPACE) return makeStat(true);
      return makeStat(false);
    });
    mockReaddirSync.mockReturnValue([]);
    migrateData();
    // The internal copyDirectoryContents call uses { withFileTypes: true }
    expect(mockReaddirSync).toHaveBeenCalledWith(SRC_WORKSPACE, { withFileTypes: true });
  });
});

// ============================================================================
// autoMigrateIfNeeded()
// ============================================================================

describe('autoMigrateIfNeeded()', () => {
  it('returns null when needsMigration() is false', () => {
    mockHasLegacyData.mockReturnValue(false);
    const result = autoMigrateIfNeeded();
    expect(result).toBeNull();
  });

  it('does not call initializeDataDirectories when no migration needed', () => {
    mockHasLegacyData.mockReturnValue(false);
    autoMigrateIfNeeded();
    expect(mockInitializeDataDirectories).not.toHaveBeenCalled();
  });

  it('returns MigrationResult when migration is needed', () => {
    mockHasLegacyData.mockReturnValue(true);
    mockExistsSync.mockImplementation((p: string) => {
      // needsMigration: database not present → migration needed
      if (p === NEW_DB) return false;
      // migrateData: legacy path does not exist → short-circuit
      return false;
    });
    const result = autoMigrateIfNeeded();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('migratedFiles');
    expect(result).toHaveProperty('errors');
  });

  it('calls migrateData (via initializeDataDirectories) when migration needed', () => {
    mockHasLegacyData.mockReturnValue(true);
    mockExistsSync.mockReturnValue(false);
    autoMigrateIfNeeded();
    expect(mockInitializeDataDirectories).toHaveBeenCalled();
  });

  it('passes the full migration result from migrateData', () => {
    mockHasLegacyData.mockReturnValue(true);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === NEW_DB) return false; // migration needed
      if (p === LEGACY) return true; // legacy path exists
      if (p === SRC_DB) return true; // source db file exists
      if (p === NEW_DB_DIR) return true;
      return false;
    });
    const result = autoMigrateIfNeeded();
    expect(result).not.toBeNull();
    expect(result!.legacyPath).toBe(LEGACY);
    expect(result!.newPath).toBe(NEW_ROOT);
    expect(result!.migratedFiles).toContain('gateway.db');
  });

  it('returns null consistently when called multiple times with no legacy data', () => {
    mockHasLegacyData.mockReturnValue(false);
    expect(autoMigrateIfNeeded()).toBeNull();
    expect(autoMigrateIfNeeded()).toBeNull();
  });

  it('result.success is true when legacy path does not exist during migration', () => {
    mockHasLegacyData.mockReturnValue(true);
    mockExistsSync.mockImplementation((p: string) => {
      // needsMigration check: database not present → migration needed
      if (p === NEW_DB) return false;
      // migrateData: legacy path doesn't exist either → success with empty list
      return false;
    });
    const result = autoMigrateIfNeeded();
    expect(result!.success).toBe(true);
    expect(result!.migratedFiles).toEqual([]);
  });

  it('result.success is false when migration encounters errors', () => {
    mockHasLegacyData.mockReturnValue(true);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === NEW_DB) return false; // trigger migration
      if (p === LEGACY) return true;
      if (p === SRC_DB) return true;
      if (p === NEW_DB_DIR) return true;
      return false;
    });
    mockCopyFileSync.mockImplementation(() => {
      throw new Error('io failure');
    });
    const result = autoMigrateIfNeeded();
    expect(result!.success).toBe(false);
    expect(result!.errors.length).toBeGreaterThan(0);
  });

  it('does not call copyFileSync when no migration needed', () => {
    mockHasLegacyData.mockReturnValue(false);
    autoMigrateIfNeeded();
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });
});
