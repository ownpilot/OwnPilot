/**
 * CodingAgentPermissionsRepository Tests
 *
 * Tests the repository for managing coding agent permission profiles,
 * including CRUD operations and row-to-record mapping with proper type conversions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock the adapter module
// ---------------------------------------------------------------------------

const mockAdapter: {
  [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn>;
} = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 0 }),
  exec: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  now: vi.fn().mockReturnValue('NOW()'),
  date: vi.fn().mockImplementation((col: string) => `DATE(${col})`),
  dateSubtract: vi.fn(),
  placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
  boolean: vi.fn().mockImplementation((v: boolean) => v),
  parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(mockAdapter),
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

// Import after mocks are established
const {
  CodingAgentPermissionsRepository,
  codingAgentPermissionsRepo,
  createCodingAgentPermissionsRepository,
} = await import('./coding-agent-permissions.js');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createMockPermissionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'perm-123',
    user_id: 'default',
    provider_ref: 'claude-code',
    io_format: 'stream-json',
    fs_access: 'read-write',
    allowed_dirs: '["/home/user/project"]',
    network_access: true,
    shell_access: true,
    git_access: true,
    autonomy: 'semi-auto',
    max_file_changes: 50,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function createUpsertInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    providerRef: 'claude-code',
    ioFormat: 'stream-json' as const,
    fsAccess: 'read-write' as const,
    allowedDirs: ['/home/user/project'],
    networkAccess: true,
    shellAccess: true,
    gitAccess: true,
    autonomy: 'semi-auto' as const,
    maxFileChanges: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodingAgentPermissionsRepository', () => {
  let repo: CodingAgentPermissionsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createCodingAgentPermissionsRepository();
  });

  // ---- getByProvider() ----

  describe('getByProvider', () => {
    it('returns mapped record when permission exists', async () => {
      const mockRow = createMockPermissionRow();
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.getByProvider('claude-code', 'default');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        'SELECT * FROM coding_agent_permissions WHERE provider_ref = $1 AND user_id = $2',
        ['claude-code', 'default']
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe('perm-123');
      expect(result?.userId).toBe('default');
      expect(result?.providerRef).toBe('claude-code');
      expect(result?.ioFormat).toBe('stream-json');
      expect(result?.fsAccess).toBe('read-write');
      expect(result?.allowedDirs).toEqual(['/home/user/project']);
      expect(result?.networkAccess).toBe(true);
      expect(result?.shellAccess).toBe(true);
      expect(result?.gitAccess).toBe(true);
      expect(result?.autonomy).toBe('semi-auto');
      expect(result?.maxFileChanges).toBe(50);
    });

    it('returns null when permission does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getByProvider('nonexistent', 'default');

      expect(result).toBeNull();
    });

    it('uses default userId when not provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(createMockPermissionRow());

      await repo.getByProvider('claude-code');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.any(String),
        ['claude-code', 'default']
      );
    });

    it('handles different io formats', async () => {
      const formats = ['text', 'json', 'stream-json'];

      for (const format of formats) {
        vi.clearAllMocks();
        mockAdapter.queryOne.mockResolvedValueOnce(
          createMockPermissionRow({ io_format: format })
        );

        const result = await repo.getByProvider('test');
        expect(result?.ioFormat).toBe(format);
      }
    });

    it('handles different fs access levels', async () => {
      const levels = ['none', 'read-only', 'read-write', 'full'];

      for (const level of levels) {
        vi.clearAllMocks();
        mockAdapter.queryOne.mockResolvedValueOnce(
          createMockPermissionRow({ fs_access: level })
        );

        const result = await repo.getByProvider('test');
        expect(result?.fsAccess).toBe(level);
      }
    });

    it('handles different autonomy levels', async () => {
      const levels = ['supervised', 'semi-auto', 'full-auto'];

      for (const level of levels) {
        vi.clearAllMocks();
        mockAdapter.queryOne.mockResolvedValueOnce(
          createMockPermissionRow({ autonomy: level })
        );

        const result = await repo.getByProvider('test');
        expect(result?.autonomy).toBe(level);
      }
    });

    it('parses boolean values from postgres numeric format', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockPermissionRow({
          network_access: 1,
          shell_access: 0,
          git_access: 1,
        })
      );

      const result = await repo.getByProvider('test');

      expect(result?.networkAccess).toBe(true);
      expect(result?.shellAccess).toBe(false);
      expect(result?.gitAccess).toBe(true);
    });

    it('handles empty allowed_dirs', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockPermissionRow({ allowed_dirs: '[]' })
      );

      const result = await repo.getByProvider('test');

      expect(result?.allowedDirs).toEqual([]);
    });

    it('handles null allowed_dirs', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockPermissionRow({ allowed_dirs: null })
      );

      const result = await repo.getByProvider('test');

      expect(result?.allowedDirs).toEqual([]);
    });

    it('converts max_file_changes to number', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockPermissionRow({ max_file_changes: '100' })
      );

      const result = await repo.getByProvider('test');

      expect(result?.maxFileChanges).toBe(100);
      expect(typeof result?.maxFileChanges).toBe('number');
    });
  });

  // ---- list() ----

  describe('list', () => {
    it('returns empty array when no permissions', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list('default');

      expect(result).toEqual([]);
    });

    it('returns mapped permissions ordered by provider_ref', async () => {
      const mockRows = [
        createMockPermissionRow({ provider_ref: 'claude-code', id: 'perm-1' }),
        createMockPermissionRow({ provider_ref: 'copilot', id: 'perm-2' }),
        createMockPermissionRow({ provider_ref: 'cursor', id: 'perm-3' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(mockRows);

      const result = await repo.list('default');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        'SELECT * FROM coding_agent_permissions WHERE user_id = $1 ORDER BY provider_ref',
        ['default']
      );

      expect(result).toHaveLength(3);
      expect(result[0].providerRef).toBe('claude-code');
      expect(result[1].providerRef).toBe('copilot');
      expect(result[2].providerRef).toBe('cursor');
    });

    it('uses default userId when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['default']);
    });

    it('filters by userId', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        createMockPermissionRow({ user_id: 'user-123', provider_ref: 'test' }),
      ]);

      const result = await repo.list('user-123');

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['user-123']);
      expect(result[0].userId).toBe('user-123');
    });
  });

  // ---- upsert() ----

  describe('upsert', () => {
    it('creates new permission with all fields', async () => {
      const input = createUpsertInput();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(createMockPermissionRow());

      const result = await repo.upsert(input, 'default');

      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO coding_agent_permissions');
      expect(sql).toContain('ON CONFLICT (user_id, provider_ref) DO UPDATE SET');
      expect(params).toHaveLength(13);
      expect(params[1]).toBe('default'); // user_id
      expect(params[2]).toBe('claude-code'); // provider_ref
      expect(params[3]).toBe('stream-json'); // io_format
      expect(params[4]).toBe('read-write'); // fs_access
      expect(params[5]).toBe(JSON.stringify(['/home/user/project'])); // allowed_dirs
      expect(params[6]).toBe(true); // network_access
      expect(params[7]).toBe(true); // shell_access
      expect(params[8]).toBe(true); // git_access
      expect(params[9]).toBe('semi-auto'); // autonomy
      expect(params[10]).toBe(50); // max_file_changes

      expect(result.providerRef).toBe('claude-code');
    });

    it('uses default values when optional fields omitted', async () => {
      const input = { providerRef: 'new-provider' };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockPermissionRow({
          provider_ref: 'new-provider',
          io_format: 'text',
          fs_access: 'read-write',
          allowed_dirs: '[]',
          network_access: true,
          shell_access: true,
          git_access: true,
          autonomy: 'semi-auto',
          max_file_changes: 50,
        })
      );

      await repo.upsert(input);

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[3]).toBe('text'); // default ioFormat
      expect(params[4]).toBe('read-write'); // default fsAccess
      expect(params[5]).toBe('[]'); // default allowedDirs
      expect(params[6]).toBe(true); // default networkAccess
      expect(params[7]).toBe(true); // default shellAccess
      expect(params[8]).toBe(true); // default gitAccess
      expect(params[9]).toBe('semi-auto'); // default autonomy
      expect(params[10]).toBe(50); // default maxFileChanges
    });

    it('throws error when getByProvider returns null after upsert', async () => {
      const input = createUpsertInput();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.upsert(input)).rejects.toThrow('Failed to upsert permission profile');
    });

    it('uses default userId when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(createMockPermissionRow());

      await repo.upsert({ providerRef: 'test' });

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[1]).toBe('default');
    });

    it('handles custom userId', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockPermissionRow({ user_id: 'user-456' })
      );

      await repo.upsert({ providerRef: 'test' }, 'user-456');

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[1]).toBe('user-456');
    });

    it('handles restricted permissions', async () => {
      const input = createUpsertInput({
        fsAccess: 'read-only',
        networkAccess: false,
        shellAccess: false,
        gitAccess: false,
        autonomy: 'supervised',
        maxFileChanges: 10,
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockPermissionRow({
          fs_access: 'read-only',
          network_access: false,
          shell_access: false,
          git_access: false,
          autonomy: 'supervised',
          max_file_changes: 10,
        })
      );

      const result = await repo.upsert(input);

      expect(result.fsAccess).toBe('read-only');
      expect(result.networkAccess).toBe(false);
      expect(result.shellAccess).toBe(false);
      expect(result.gitAccess).toBe(false);
      expect(result.autonomy).toBe('supervised');
      expect(result.maxFileChanges).toBe(10);
    });
  });

  // ---- delete() ----

  describe('delete', () => {
    it('returns true when permission was deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('claude-code', 'default');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'DELETE FROM coding_agent_permissions WHERE provider_ref = $1 AND user_id = $2',
        ['claude-code', 'default']
      );
      expect(result).toBe(true);
    });

    it('returns false when no permission was found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('nonexistent', 'default');

      expect(result).toBe(false);
    });

    it('uses default userId when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('claude-code');

      expect(mockAdapter.execute).toHaveBeenCalledWith(expect.any(String), [
        'claude-code',
        'default',
      ]);
    });

    it('handles null result from execute', async () => {
      mockAdapter.execute.mockResolvedValueOnce(null);

      const result = await repo.delete('test');

      expect(result).toBe(false);
    });
  });

  // ---- singleton instance ----

  describe('codingAgentPermissionsRepo singleton', () => {
    it('is exported as a singleton instance', () => {
      expect(codingAgentPermissionsRepo).toBeInstanceOf(CodingAgentPermissionsRepository);
    });

    it('createCodingAgentPermissionsRepository creates new instances', () => {
      const repo1 = createCodingAgentPermissionsRepository();
      const repo2 = createCodingAgentPermissionsRepository();

      expect(repo1).toBeInstanceOf(CodingAgentPermissionsRepository);
      expect(repo2).toBeInstanceOf(CodingAgentPermissionsRepository);
      expect(repo1).not.toBe(repo2);
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    it('propagates database errors on getByProvider', async () => {
      mockAdapter.queryOne.mockRejectedValueOnce(new Error('connection failed'));

      await expect(repo.getByProvider('test')).rejects.toThrow('connection failed');
    });

    it('propagates database errors on list', async () => {
      mockAdapter.query.mockRejectedValueOnce(new Error('query timeout'));

      await expect(repo.list()).rejects.toThrow('query timeout');
    });

    it('propagates database errors on upsert', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('constraint violation'));

      await expect(repo.upsert({ providerRef: 'test' })).rejects.toThrow('constraint violation');
    });

    it('propagates database errors on delete', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('permission denied'));

      await expect(repo.delete('test')).rejects.toThrow('permission denied');
    });
  });
});
