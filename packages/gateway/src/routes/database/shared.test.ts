/**
 * Database Routes — Shared Utilities Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockExistsSync, mockMkdirSync, mockGetDataPaths } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockGetDataPaths: vi.fn(() => ({ root: '/data' })),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock('../../paths/index.js', () => ({
  getDataPaths: mockGetDataPaths,
}));

import {
  EXPORT_TABLES,
  validateTableName,
  validateColumnName,
  quoteIdentifier,
  getBackupDir,
  operationStatus,
  getTableScope,
  getUserFilter,
} from './shared.js';

// ---------------------------------------------------------------------------
// EXPORT_TABLES
// ---------------------------------------------------------------------------

describe('EXPORT_TABLES', () => {
  it('is an array', () => {
    expect(Array.isArray(EXPORT_TABLES)).toBe(true);
  });

  it('contains core tables', () => {
    expect(EXPORT_TABLES).toContain('settings');
    expect(EXPORT_TABLES).toContain('agents');
    expect(EXPORT_TABLES).toContain('conversations');
    expect(EXPORT_TABLES).toContain('messages');
  });

  it('contains data tables', () => {
    expect(EXPORT_TABLES).toContain('memories');
    expect(EXPORT_TABLES).toContain('goals');
    expect(EXPORT_TABLES).toContain('triggers');
    expect(EXPORT_TABLES).toContain('plans');
  });

  it('has no duplicates', () => {
    expect(new Set(EXPORT_TABLES).size).toBe(EXPORT_TABLES.length);
  });
});

// ---------------------------------------------------------------------------
// validateTableName
// ---------------------------------------------------------------------------

describe('validateTableName', () => {
  it('returns lowercase trimmed name for valid whitelisted table', () => {
    expect(validateTableName('settings')).toBe('settings');
  });

  it('trims whitespace before checking', () => {
    expect(validateTableName('  settings  ')).toBe('settings');
  });

  it('lowercases the name', () => {
    expect(validateTableName('SETTINGS')).toBe('settings');
  });

  it('throws for table not in whitelist', () => {
    expect(() => validateTableName('evil_table')).toThrow('Table not in whitelist');
  });

  it('throws for SQL injection attempts', () => {
    expect(() => validateTableName('users; DROP TABLE --')).toThrow('Invalid table name');
  });

  it('throws for name with dashes', () => {
    expect(() => validateTableName('user-data')).toThrow('Invalid table name');
  });

  it('throws for empty string', () => {
    expect(() => validateTableName('')).toThrow();
  });

  it('throws for name starting with number', () => {
    expect(() => validateTableName('1settings')).toThrow('Invalid table name');
  });

  it('throws for name with spaces', () => {
    expect(() => validateTableName('my table')).toThrow('Invalid table name');
  });

  it('validates all EXPORT_TABLES without throwing', () => {
    for (const table of EXPORT_TABLES) {
      expect(() => validateTableName(table)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// validateColumnName
// ---------------------------------------------------------------------------

describe('validateColumnName', () => {
  it('returns lowercase trimmed column name', () => {
    expect(validateColumnName('user_id')).toBe('user_id');
  });

  it('trims whitespace', () => {
    expect(validateColumnName('  created_at  ')).toBe('created_at');
  });

  it('lowercases the name', () => {
    expect(validateColumnName('UserId')).toBe('userid');
  });

  it('throws for column with SQL injection', () => {
    expect(() => validateColumnName('col; DROP TABLE')).toThrow('Invalid column name');
  });

  it('throws for column starting with number', () => {
    expect(() => validateColumnName('1col')).toThrow('Invalid column name');
  });

  it('throws for column with dashes', () => {
    expect(() => validateColumnName('col-name')).toThrow('Invalid column name');
  });

  it('does NOT check whitelist (unlike validateTableName)', () => {
    // Any valid identifier passes
    expect(validateColumnName('any_valid_name')).toBe('any_valid_name');
  });
});

// ---------------------------------------------------------------------------
// quoteIdentifier
// ---------------------------------------------------------------------------

describe('quoteIdentifier', () => {
  it('wraps name in double quotes', () => {
    expect(quoteIdentifier('user_id')).toBe('"user_id"');
  });

  it('escapes embedded double quotes', () => {
    expect(quoteIdentifier('col"with"quotes')).toBe('"col""with""quotes"');
  });

  it('handles empty string', () => {
    expect(quoteIdentifier('')).toBe('""');
  });

  it('handles normal table name', () => {
    expect(quoteIdentifier('settings')).toBe('"settings"');
  });
});

// ---------------------------------------------------------------------------
// getBackupDir
// ---------------------------------------------------------------------------

describe('getBackupDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDataPaths.mockReturnValue({ root: '/data' });
  });

  it('returns backup directory path', () => {
    mockExistsSync.mockReturnValue(true);
    const dir = getBackupDir();
    expect(dir).toContain('backups');
  });

  it('creates directory if it does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    getBackupDir();
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('backups'), {
      recursive: true,
    });
  });

  it('does not create directory if already exists', () => {
    mockExistsSync.mockReturnValue(true);
    getBackupDir();
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// operationStatus / setOperationStatus
// ---------------------------------------------------------------------------

describe('operationStatus and setOperationStatus', () => {
  it('initial operationStatus has isRunning: false', () => {
    expect(operationStatus.isRunning).toBe(false);
  });

  it('setOperationStatus updates the shared state', async () => {
    // Import fresh reference
    const mod = await import('./shared.js');
    mod.setOperationStatus({ isRunning: true, operation: 'backup' });
    expect(mod.operationStatus.isRunning).toBe(true);
    expect(mod.operationStatus.operation).toBe('backup');
    // Reset
    mod.setOperationStatus({ isRunning: false });
  });

  it('setOperationStatus with result and error', async () => {
    const mod = await import('./shared.js');
    mod.setOperationStatus({
      isRunning: false,
      lastResult: 'failure',
      lastError: 'Something went wrong',
      output: ['line1', 'line2'],
    });
    expect(mod.operationStatus.lastResult).toBe('failure');
    expect(mod.operationStatus.lastError).toBe('Something went wrong');
    expect(mod.operationStatus.output).toEqual(['line1', 'line2']);
    // Reset
    mod.setOperationStatus({ isRunning: false });
  });
});

// ---------------------------------------------------------------------------
// Plan 11 Step 3 (CSV-002): per-user export filtering
// ---------------------------------------------------------------------------

describe('getTableScope', () => {
  it('classifies per-user tables', () => {
    expect(getTableScope('conversations')).toBe('per-user');
    expect(getTableScope('tasks')).toBe('per-user');
    expect(getTableScope('habits')).toBe('per-user');
    expect(getTableScope('user_extensions')).toBe('per-user');
    expect(getTableScope('claws')).toBe('per-user');
  });

  it('classifies child tables', () => {
    expect(getTableScope('messages')).toBe('child');
    expect(getTableScope('goal_steps')).toBe('child');
    expect(getTableScope('plan_steps')).toBe('child');
    expect(getTableScope('claw_history')).toBe('child');
  });

  it('classifies system tables (default)', () => {
    expect(getTableScope('settings')).toBe('system');
    expect(getTableScope('system_settings')).toBe('system');
    expect(getTableScope('channels')).toBe('system');
    expect(getTableScope('agents')).toBe('system');
  });

  it('every EXPORT_TABLES entry is one of the three scopes', () => {
    for (const t of EXPORT_TABLES) {
      const scope = getTableScope(t);
      expect(['per-user', 'child', 'system']).toContain(scope);
    }
  });
});

describe('getUserFilter (per-user scope)', () => {
  it('returns WHERE user_id = $1 for per-user tables', () => {
    const f = getUserFilter('conversations', 'alice');
    expect(f.where).toBe(' WHERE user_id = $1');
    expect(f.params).toEqual(['alice']);
  });

  it('uses paramOffset for the placeholder', () => {
    const f = getUserFilter('tasks', 'bob', 3);
    expect(f.where).toBe(' WHERE user_id = $3');
    expect(f.params).toEqual(['bob']);
  });

  it('returns no filter when userId is undefined (legacy fallback)', () => {
    const f = getUserFilter('conversations', undefined);
    expect(f.where).toBe('');
    expect(f.params).toEqual([]);
  });

  it('returns no filter for system tables even with a userId', () => {
    const f = getUserFilter('settings', 'alice');
    expect(f.where).toBe('');
    expect(f.params).toEqual([]);
  });
});

describe('getUserFilter (child scope)', () => {
  it('uses WHERE EXISTS with parent join for messages', () => {
    const f = getUserFilter('messages', 'alice');
    expect(f.where).toContain('EXISTS');
    expect(f.where).toContain('"conversations"');
    expect(f.where).toContain('"messages"');
    expect(f.where).toContain('"conversation_id"');
    expect(f.where).toContain('"conversations".user_id = $1');
    expect(f.params).toEqual(['alice']);
  });

  it('uses goal_steps → goals', () => {
    const f = getUserFilter('goal_steps', 'alice');
    expect(f.where).toContain('"goals"');
    expect(f.where).toContain('"goal_id"');
    expect(f.where).toContain('"goals".user_id = $1');
  });

  it('uses plan_steps → plans', () => {
    const f = getUserFilter('plan_steps', 'alice');
    expect(f.where).toContain('"plans"');
    expect(f.where).toContain('"plan_id"');
  });

  it('uses claw_history → claws', () => {
    const f = getUserFilter('claw_history', 'alice');
    expect(f.where).toContain('"claws"');
    expect(f.where).toContain('"claw_id"');
  });

  it('returns no filter for child tables when userId is undefined', () => {
    const f = getUserFilter('messages', undefined);
    expect(f.where).toBe('');
    expect(f.params).toEqual([]);
  });
});

describe('getUserFilter (system scope)', () => {
  it.each(['settings', 'system_settings', 'channels', 'agents', 'plugins'])(
    'returns no filter for system table %s',
    (t) => {
      const f = getUserFilter(t, 'alice');
      expect(f.where).toBe('');
      expect(f.params).toEqual([]);
    }
  );
});

describe('getUserFilter — coverage audit', () => {
  it('every per-user table in EXPORT_TABLES is filtered', () => {
    for (const t of EXPORT_TABLES) {
      if (getTableScope(t) === 'per-user') {
        const f = getUserFilter(t, 'alice');
        expect(f.where).toMatch(/WHERE user_id = \$1/);
        expect(f.params).toEqual(['alice']);
      }
    }
  });

  it('every child table in EXPORT_TABLES uses an EXISTS subquery', () => {
    for (const t of EXPORT_TABLES) {
      if (getTableScope(t) === 'child') {
        const f = getUserFilter(t, 'alice');
        expect(f.where).toContain('EXISTS');
        expect(f.params).toEqual(['alice']);
      }
    }
  });
});
