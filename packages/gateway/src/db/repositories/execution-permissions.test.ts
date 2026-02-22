/**
 * ExecutionPermissionsRepository Tests
 *
 * Unit tests for get/set/reset operations, row-to-permissions mapping,
 * partial merge logic, mode validation, and category permission filtering.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
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
  date: vi.fn(),
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

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@ownpilot/core', () => ({
  DEFAULT_EXECUTION_PERMISSIONS: {
    enabled: false,
    mode: 'local',
    execute_javascript: 'blocked',
    execute_python: 'blocked',
    execute_shell: 'blocked',
    compile_code: 'blocked',
    package_manager: 'blocked',
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { executionPermissionsRepo } = await import('./execution-permissions.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makePermissionRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    enabled: 1,
    mode: 'local',
    execute_javascript: 'allowed',
    execute_python: 'prompt',
    execute_shell: 'blocked',
    compile_code: 'blocked',
    package_manager: 'blocked',
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionPermissionsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return defaults when no row exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await executionPermissionsRepo.get('user-1');

      expect(result).toEqual({
        enabled: false,
        mode: 'local',
        execute_javascript: 'blocked',
        execute_python: 'blocked',
        execute_shell: 'blocked',
        compile_code: 'blocked',
        package_manager: 'blocked',
      });
    });

    it('should return a copy of defaults (not the same reference)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result1 = await executionPermissionsRepo.get('user-1');

      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result2 = await executionPermissionsRepo.get('user-1');

      expect(result1).not.toBe(result2);
      expect(result1).toEqual(result2);
    });

    it('should map a row correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow());

      const result = await executionPermissionsRepo.get('user-1');

      expect(result).toEqual({
        enabled: true,
        mode: 'local',
        execute_javascript: 'allowed',
        execute_python: 'prompt',
        execute_shell: 'blocked',
        compile_code: 'blocked',
        package_manager: 'blocked',
      });
    });

    it('should coerce numeric enabled=1 to true via Boolean()', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ enabled: 1 }));

      const result = await executionPermissionsRepo.get('user-1');

      expect(result.enabled).toBe(true);
    });

    it('should coerce numeric enabled=0 to false via Boolean()', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ enabled: 0 }));

      const result = await executionPermissionsRepo.get('user-1');

      expect(result.enabled).toBe(false);
    });

    it('should coerce boolean enabled=true directly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ enabled: true }));

      const result = await executionPermissionsRepo.get('user-1');

      expect(result.enabled).toBe(true);
    });

    it('should coerce boolean enabled=false directly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ enabled: false }));

      const result = await executionPermissionsRepo.get('user-1');

      expect(result.enabled).toBe(false);
    });

    it('should fall back to "local" for invalid mode', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ mode: 'invalid_mode' }));

      const result = await executionPermissionsRepo.get('user-1');

      expect(result.mode).toBe('local');
    });

    it('should accept "docker" as a valid mode', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ mode: 'docker' }));

      const result = await executionPermissionsRepo.get('user-1');

      expect(result.mode).toBe('docker');
    });

    it('should accept "auto" as a valid mode', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ mode: 'auto' }));

      const result = await executionPermissionsRepo.get('user-1');

      expect(result.mode).toBe('auto');
    });

    it('should fall back to "local" for empty-string mode', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ mode: '' }));

      const result = await executionPermissionsRepo.get('user-1');

      expect(result.mode).toBe('local');
    });

    it('should map all five category fields from the row', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makePermissionRow({
          execute_javascript: 'allowed',
          execute_python: 'allowed',
          execute_shell: 'prompt',
          compile_code: 'prompt',
          package_manager: 'allowed',
        })
      );

      const result = await executionPermissionsRepo.get('user-1');

      expect(result.execute_javascript).toBe('allowed');
      expect(result.execute_python).toBe('allowed');
      expect(result.execute_shell).toBe('prompt');
      expect(result.compile_code).toBe('prompt');
      expect(result.package_manager).toBe('allowed');
    });

    it('should query with WHERE user_id = $1', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await executionPermissionsRepo.get('user-abc');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('execution_permissions');
      expect(sql).toContain('user_id');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-abc']);
    });
  });

  // =========================================================================
  // set
  // =========================================================================

  describe('set', () => {
    it('should merge partial updates with existing values', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makePermissionRow({
          enabled: 1,
          mode: 'local',
          execute_javascript: 'allowed',
          execute_python: 'prompt',
          execute_shell: 'blocked',
          compile_code: 'blocked',
          package_manager: 'blocked',
        })
      );
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {
        execute_shell: 'allowed',
      });

      // Changed field
      expect(result.execute_shell).toBe('allowed');
      // Preserved fields
      expect(result.enabled).toBe(true);
      expect(result.mode).toBe('local');
      expect(result.execute_javascript).toBe('allowed');
      expect(result.execute_python).toBe('prompt');
      expect(result.compile_code).toBe('blocked');
      expect(result.package_manager).toBe('blocked');
    });

    it('should merge with defaults when no row exists', async () => {
      // get() returns defaults when queryOne returns null
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-new', {
        enabled: true,
        execute_javascript: 'allowed',
      });

      expect(result.enabled).toBe(true);
      expect(result.execute_javascript).toBe('allowed');
      // Remaining fields should be defaults
      expect(result.mode).toBe('local');
      expect(result.execute_python).toBe('blocked');
      expect(result.execute_shell).toBe('blocked');
      expect(result.compile_code).toBe('blocked');
      expect(result.package_manager).toBe('blocked');
    });

    it('should apply enabled=true toggle', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ enabled: 0 }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', { enabled: true });

      expect(result.enabled).toBe(true);
    });

    it('should apply enabled=false toggle', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ enabled: 1 }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', { enabled: false });

      expect(result.enabled).toBe(false);
    });

    it('should not change enabled when not provided in partial', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ enabled: 1 }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', { mode: 'docker' });

      expect(result.enabled).toBe(true);
    });

    it('should apply valid mode "docker"', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ mode: 'local' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {
        mode: 'docker',
      });

      expect(result.mode).toBe('docker');
    });

    it('should apply valid mode "auto"', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ mode: 'local' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {
        mode: 'auto',
      });

      expect(result.mode).toBe('auto');
    });

    it('should ignore invalid mode and keep existing', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ mode: 'docker' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {
        mode: 'sandbox' as 'local',
      });

      expect(result.mode).toBe('docker');
    });

    it('should not change mode when not provided in partial', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ mode: 'auto' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', { enabled: true });

      expect(result.mode).toBe('auto');
    });

    it('should apply valid category mode "allowed"', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ execute_python: 'blocked' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {
        execute_python: 'allowed',
      });

      expect(result.execute_python).toBe('allowed');
    });

    it('should apply valid category mode "prompt"', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ compile_code: 'blocked' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {
        compile_code: 'prompt',
      });

      expect(result.compile_code).toBe('prompt');
    });

    it('should apply valid category mode "blocked"', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makePermissionRow({ execute_javascript: 'allowed' })
      );
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {
        execute_javascript: 'blocked',
      });

      expect(result.execute_javascript).toBe('blocked');
    });

    it('should ignore invalid category permission values', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ execute_shell: 'blocked' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {
        execute_shell: 'yolo' as 'allowed',
      });

      expect(result.execute_shell).toBe('blocked');
    });

    it('should apply multiple category changes at once', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makePermissionRow({
          execute_javascript: 'blocked',
          execute_python: 'blocked',
          execute_shell: 'blocked',
          compile_code: 'blocked',
          package_manager: 'blocked',
        })
      );
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {
        execute_javascript: 'allowed',
        execute_python: 'prompt',
        execute_shell: 'allowed',
        compile_code: 'prompt',
        package_manager: 'allowed',
      });

      expect(result.execute_javascript).toBe('allowed');
      expect(result.execute_python).toBe('prompt');
      expect(result.execute_shell).toBe('allowed');
      expect(result.compile_code).toBe('prompt');
      expect(result.package_manager).toBe('allowed');
    });

    it('should call execute with UPSERT SQL', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await executionPermissionsRepo.set('user-1', { enabled: true });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO execution_permissions');
      expect(sql).toContain('ON CONFLICT(user_id) DO UPDATE SET');
      expect(sql).toContain('excluded.enabled');
      expect(sql).toContain('excluded.mode');
      expect(sql).toContain('excluded.execute_javascript');
      expect(sql).toContain('excluded.execute_python');
      expect(sql).toContain('excluded.execute_shell');
      expect(sql).toContain('excluded.compile_code');
      expect(sql).toContain('excluded.package_manager');
      expect(sql).toContain('excluded.updated_at');
    });

    it('should pass correct params to execute', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await executionPermissionsRepo.set('user-42', {
        enabled: true,
        mode: 'docker',
        execute_javascript: 'allowed',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // [userId, enabled, mode, js, py, shell, compile, package]
      expect(params[0]).toBe('user-42');
      expect(params[1]).toBe(true);
      expect(params[2]).toBe('docker');
      expect(params[3]).toBe('allowed');
      expect(params[4]).toBe('blocked'); // default from merge
      expect(params[5]).toBe('blocked');
      expect(params[6]).toBe('blocked');
      expect(params[7]).toBe('blocked');
    });

    it('should return the merged result', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makePermissionRow({
          enabled: 1,
          mode: 'local',
          execute_javascript: 'allowed',
          execute_python: 'blocked',
          execute_shell: 'blocked',
          compile_code: 'blocked',
          package_manager: 'blocked',
        })
      );
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {
        mode: 'auto',
        execute_python: 'prompt',
      });

      expect(result).toEqual({
        enabled: true,
        mode: 'auto',
        execute_javascript: 'allowed',
        execute_python: 'prompt',
        execute_shell: 'blocked',
        compile_code: 'blocked',
        package_manager: 'blocked',
      });
    });

    it('should handle empty partial (no changes)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makePermissionRow({ enabled: 1 }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.set('user-1', {});

      // Should preserve all existing values
      expect(result.enabled).toBe(true);
      expect(result.mode).toBe('local');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // reset
  // =========================================================================

  describe('reset', () => {
    it('should call DELETE with user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await executionPermissionsRepo.reset('user-1');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM execution_permissions');
      expect(sql).toContain('user_id');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1']);
    });

    it('should not throw when no row exists (0 changes)', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await expect(executionPermissionsRepo.reset('user-nonexistent')).resolves.toBeUndefined();
    });

    it('should return void', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await executionPermissionsRepo.reset('user-1');

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // Singleton export
  // =========================================================================

  describe('executionPermissionsRepo', () => {
    it('should export a singleton instance', async () => {
      const mod = await import('./execution-permissions.js');
      expect(mod.executionPermissionsRepo).toBeDefined();
      expect(typeof mod.executionPermissionsRepo.get).toBe('function');
      expect(typeof mod.executionPermissionsRepo.set).toBe('function');
      expect(typeof mod.executionPermissionsRepo.reset).toBe('function');
    });
  });
});
