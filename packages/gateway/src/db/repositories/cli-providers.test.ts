/**
 * CLI Providers Repository Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

import { CliProvidersRepository } from './cli-providers.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2026-02-25T12:00:00.000Z';

function makeProviderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prov-1',
    user_id: 'default',
    name: 'prettier',
    display_name: 'Prettier',
    description: 'Code formatter',
    binary: 'prettier',
    category: 'formatter',
    icon: null,
    color: null,
    auth_method: 'none',
    config_service_name: null,
    api_key_env_var: null,
    default_args: JSON.stringify(['--write']),
    prompt_template: null,
    output_format: 'text',
    default_timeout_ms: 300000,
    max_timeout_ms: 1800000,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CliProvidersRepository', () => {
  let repo: CliProvidersRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CliProvidersRepository();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a provider and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());

      const result = await repo.create({
        name: 'prettier',
        displayName: 'Prettier',
        description: 'Code formatter',
        binary: 'prettier',
        category: 'formatter',
        defaultArgs: ['--write'],
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.name).toBe('prettier');
      expect(result.displayName).toBe('Prettier');
      expect(result.binary).toBe('prettier');
      expect(result.defaultArgs).toEqual(['--write']);
      expect(result.isActive).toBe(true);
    });

    it('should use default values for optional fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());

      await repo.create({
        name: 'prettier',
        displayName: 'Prettier',
        binary: 'prettier',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // userId
      expect(params[1]).toBe('default');
      // category
      expect(params[6]).toBe('general');
      // authMethod
      expect(params[9]).toBe('none');
      // defaultArgs
      expect(params[12]).toBe('[]');
      // outputFormat
      expect(params[14]).toBe('text');
      // defaultTimeoutMs
      expect(params[15]).toBe(300000);
      // maxTimeoutMs
      expect(params[16]).toBe(1800000);
    });

    it('should throw when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          name: 'test',
          displayName: 'Test',
          binary: 'test',
        })
      ).rejects.toThrow('Failed to create CLI provider');
    });

    it('should include INSERT INTO cli_providers in SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());

      await repo.create({
        name: 'prettier',
        displayName: 'Prettier',
        binary: 'prettier',
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO cli_providers');
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('should return a provider when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());

      const result = await repo.getById('prov-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('prov-1');
      expect(result!.name).toBe('prettier');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getById('missing')).toBeNull();
    });

    it('should parse JSONB defaultArgs', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({ default_args: JSON.stringify(['--fix', '--format', 'json']) })
      );

      const result = await repo.getById('prov-1');

      expect(result!.defaultArgs).toEqual(['--fix', '--format', 'json']);
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({ description: null, icon: null, color: null })
      );

      const result = await repo.getById('prov-1');

      expect(result!.description).toBeUndefined();
      expect(result!.icon).toBeUndefined();
      expect(result!.color).toBeUndefined();
    });

    it('should parse boolean is_active', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow({ is_active: false }));

      const result = await repo.getById('prov-1');

      expect(result!.isActive).toBe(false);
    });
  });

  // =========================================================================
  // getByName
  // =========================================================================

  describe('getByName', () => {
    it('should return provider by name and userId', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());

      const result = await repo.getByName('prettier');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('prettier');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getByName('missing')).toBeNull();
    });

    it('should filter by name and user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getByName('prettier', 'user-42');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('name = $1');
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['prettier', 'user-42']);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return all providers for user', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeProviderRow({ id: 'prov-1', name: 'prettier' }),
        makeProviderRow({ id: 'prov-2', name: 'eslint' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no providers', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should order by display_name', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY display_name');
    });

    it('should filter by user_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list('user-42');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-42']);
    });
  });

  // =========================================================================
  // listActive
  // =========================================================================

  describe('listActive', () => {
    it('should only return active providers', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeProviderRow()]);

      const result = await repo.listActive();

      expect(result).toHaveLength(1);
    });

    it('should filter by is_active = TRUE', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listActive();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_active = TRUE');
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update specified fields', async () => {
      // getById for existence check
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getById after update
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({ display_name: 'Prettier v2', binary: 'npx prettier' })
      );

      const result = await repo.update('prov-1', {
        displayName: 'Prettier v2',
        binary: 'npx prettier',
      });

      expect(result).not.toBeNull();
      expect(result!.displayName).toBe('Prettier v2');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null when provider not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.update('missing', { displayName: 'X' })).toBeNull();
    });

    it('should return existing record when no fields to update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());

      const result = await repo.update('prov-1', {});

      expect(result).not.toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should serialize defaultArgs as JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());

      await repo.update('prov-1', { defaultArgs: ['--fix'] });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain(JSON.stringify(['--fix']));
    });

    it('should always set updated_at', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());

      await repo.update('prov-1', { isActive: false });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('updated_at');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('prov-1')).toBe(true);
    });

    it('should return false when not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should execute DELETE FROM cli_providers', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('prov-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM cli_providers');
      expect(sql).toContain('WHERE id = $1');
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('should return the count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });

      expect(await repo.count()).toBe(5);
    });

    it('should return 0 when row is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });

    it('should filter by user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '3' });

      await repo.count('user-42');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-42']);
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('factory', () => {
    it('createCliProvidersRepository should return instance', async () => {
      const { createCliProvidersRepository } = await import('./cli-providers.js');
      const r = createCliProvidersRepository();
      expect(r).toBeInstanceOf(CliProvidersRepository);
    });

    it('cliProvidersRepo should be a singleton', async () => {
      const { cliProvidersRepo } = await import('./cli-providers.js');
      expect(cliProvidersRepo).toBeInstanceOf(CliProvidersRepository);
    });
  });
});
