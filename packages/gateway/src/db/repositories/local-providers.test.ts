/**
 * Local Providers Repository Tests
 *
 * Unit tests for LocalProvidersRepository provider/model CRUD,
 * cache initialization, setDefault, toggle, discovery, and
 * JSONB/boolean parsing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = {
  type: 'postgres' as const,
  isConnected: () => true,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 1 })),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  exec: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  now: () => 'NOW()',
  date: (col: string) => `DATE(${col})`,
  dateSubtract: (col: string, n: number, u: string) => `${col} - INTERVAL '${n} ${u}'`,
  placeholder: (i: number) => `$${i}`,
  boolean: (v: boolean) => v,
  parseBoolean: (v: unknown) => Boolean(v),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

import { LocalProvidersRepository } from './local-providers.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeProviderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prov_1',
    user_id: 'user-1',
    name: 'My Ollama',
    provider_type: 'ollama',
    base_url: 'http://localhost:11434',
    api_key: null,
    is_enabled: true,
    is_default: false,
    discovery_endpoint: null,
    last_discovered_at: null,
    metadata: '{}',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeModelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'model_1',
    user_id: 'user-1',
    local_provider_id: 'prov_1',
    model_id: 'llama3:latest',
    display_name: 'Llama 3',
    capabilities: '["text"]',
    context_window: 8192,
    max_output: 4096,
    is_enabled: true,
    metadata: '{}',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalProvidersRepository', () => {
  let repo: LocalProvidersRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new LocalProvidersRepository();
  });

  // =========================================================================
  // initialize / refreshCache
  // =========================================================================

  describe('initialize', () => {
    it('should load providers and models into cache', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()]) // providers
        .mockResolvedValueOnce([makeModelRow()]); // models

      await repo.initialize();

      const providers = await repo.listProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0]!.name).toBe('My Ollama');
    });

    it('should handle empty database', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([]) // providers
        .mockResolvedValueOnce([]); // models

      await repo.initialize();

      const providers = await repo.listProviders();
      expect(providers).toEqual([]);
    });

    it('should group models by provider id', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([
          makeModelRow({ id: 'model_1', model_id: 'llama3:latest' }),
          makeModelRow({ id: 'model_2', model_id: 'mistral:latest', display_name: 'Mistral' }),
        ]);

      await repo.initialize();

      const models = await repo.listModels(undefined, 'prov_1');
      expect(models).toHaveLength(2);
    });
  });

  // =========================================================================
  // listProviders
  // =========================================================================

  describe('listProviders', () => {
    beforeEach(async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          makeProviderRow({ id: 'prov_1', user_id: 'user-1' }),
          makeProviderRow({ id: 'prov_2', user_id: 'user-2', name: 'Other' }),
        ])
        .mockResolvedValueOnce([]);
      await repo.initialize();
    });

    it('should return all providers when no userId', async () => {
      const providers = await repo.listProviders();
      expect(providers).toHaveLength(2);
    });

    it('should filter by userId', async () => {
      const providers = await repo.listProviders('user-1');
      expect(providers).toHaveLength(1);
      expect(providers[0]!.userId).toBe('user-1');
    });

    it('should return empty array when no match', async () => {
      const providers = await repo.listProviders('unknown');
      expect(providers).toEqual([]);
    });
  });

  // =========================================================================
  // getProvider
  // =========================================================================

  describe('getProvider', () => {
    it('should return provider from cache', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.getProvider('prov_1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('prov_1');
      expect(result!.providerType).toBe('ollama');
      expect(result!.baseUrl).toBe('http://localhost:11434');
    });

    it('should return null when not found', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      expect(await repo.getProvider('missing')).toBeNull();
    });

    it('should return null from cache for unknown id (cache miss)', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      expect(await repo.getProvider('unknown-id')).toBeNull();
    });

    it('should parse metadata JSON', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow({ metadata: '{"version":"1.0"}' })])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.getProvider('prov_1');

      expect(result!.metadata).toEqual({ version: '1.0' });
    });

    it('should handle invalid metadata JSON gracefully', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow({ metadata: 'invalid' })])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.getProvider('prov_1');

      expect(result!.metadata).toEqual({});
    });

    it('should handle null metadata', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow({ metadata: null })])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.getProvider('prov_1');

      expect(result!.metadata).toEqual({});
    });

    it('should convert boolean fields from various formats', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow({ is_enabled: 1, is_default: 'true' })])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.getProvider('prov_1');

      expect(result!.isEnabled).toBe(true);
      expect(result!.isDefault).toBe(true);
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.getProvider('prov_1');

      expect(result!.apiKey).toBeUndefined();
      expect(result!.discoveryEndpoint).toBeUndefined();
      expect(result!.lastDiscoveredAt).toBeUndefined();
    });
  });

  // =========================================================================
  // getProviderSync
  // =========================================================================

  describe('getProviderSync', () => {
    it('should return provider synchronously from cache', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = repo.getProviderSync('prov_1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('prov_1');
    });

    it('should return null for unknown id', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      expect(repo.getProviderSync('unknown-id')).toBeNull();
    });

    it('should return null when not found', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      expect(repo.getProviderSync('missing')).toBeNull();
    });
  });

  // =========================================================================
  // getDefault
  // =========================================================================

  describe('getDefault', () => {
    it('should return the default provider', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          makeProviderRow({ id: 'prov_1', is_default: false }),
          makeProviderRow({ id: 'prov_2', is_default: true, name: 'Default' }),
        ])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.getDefault();

      expect(result).not.toBeNull();
      expect(result!.id).toBe('prov_2');
      expect(result!.isDefault).toBe(true);
    });

    it('should return null when no default', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow({ is_default: false })])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      expect(await repo.getDefault()).toBeNull();
    });

    it('should filter by userId when provided', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          makeProviderRow({ id: 'prov_1', user_id: 'user-1', is_default: true }),
          makeProviderRow({ id: 'prov_2', user_id: 'user-2', is_default: true, name: 'Other' }),
        ])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.getDefault('user-1');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when no provider is default', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow({ is_default: false })])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      expect(await repo.getDefault('nonexistent-user')).toBeNull();
    });
  });

  // =========================================================================
  // createProvider
  // =========================================================================

  describe('createProvider', () => {
    it('should insert provider and refresh cache', async () => {
      // Initialize cache first
      mockAdapter.query
        .mockResolvedValueOnce([]) // providers
        .mockResolvedValueOnce([]); // models
      await repo.initialize();

      // execute insert
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshProviderCache -> queryOne provider
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow({ id: 'test-uuid-1234' }));
      // refreshProviderCache -> query models
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.createProvider({
        name: 'My Ollama',
        providerType: 'ollama',
        baseUrl: 'http://localhost:11434',
      });

      expect(result.name).toBe('My Ollama');
      expect(result.providerType).toBe('ollama');
      expect(result.baseUrl).toBe('http://localhost:11434');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should default userId to "default"', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({ id: 'test-uuid-1234', user_id: 'default' }),
      );
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.createProvider({
        name: 'Test',
        providerType: 'ollama',
        baseUrl: 'http://localhost:11434',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('default'); // userId
    });

    it('should use provided userId', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({ id: 'test-uuid-1234', user_id: 'custom' }),
      );
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.createProvider({
        name: 'Test',
        providerType: 'lmstudio',
        baseUrl: 'http://localhost:1234',
        userId: 'custom',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('custom');
    });

    it('should set is_enabled=true and is_default=false', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({ id: 'test-uuid-1234' }),
      );
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.createProvider({
        name: 'Test',
        providerType: 'ollama',
        baseUrl: 'http://localhost:11434',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe(true); // is_enabled
      expect(params[7]).toBe(false); // is_default
    });

    it('should store optional apiKey and discoveryEndpoint', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({
          id: 'test-uuid-1234',
          api_key: 'secret',
          discovery_endpoint: '/v1/models',
        }),
      );
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.createProvider({
        name: 'Test',
        providerType: 'localai',
        baseUrl: 'http://localhost:8080',
        apiKey: 'secret',
        discoveryEndpoint: '/v1/models',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('secret');
      expect(params[8]).toBe('/v1/models');
    });
  });

  // =========================================================================
  // updateProvider
  // =========================================================================

  describe('updateProvider', () => {
    beforeEach(async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();
    });

    it('should return null when provider not found', async () => {
      expect(await repo.updateProvider('missing', { name: 'New' })).toBeNull();
    });

    it('should return existing when no updates', async () => {
      const result = await repo.updateProvider('prov_1', {});

      expect(result).not.toBeNull();
      expect(result!.name).toBe('My Ollama');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should update name', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshProviderCache
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow({ name: 'Updated' }));
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.updateProvider('prov_1', { name: 'Updated' });

      expect(result!.name).toBe('Updated');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('name = $');
    });

    it('should update baseUrl', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({ base_url: 'http://new:1234' }),
      );
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.updateProvider('prov_1', {
        baseUrl: 'http://new:1234',
      });

      expect(result!.baseUrl).toBe('http://new:1234');
    });

    it('should update isEnabled', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({ is_enabled: false }),
      );
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.updateProvider('prov_1', { isEnabled: false });

      expect(result!.isEnabled).toBe(false);
    });

    it('should update multiple fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({
          name: 'New Name',
          base_url: 'http://new:5000',
          api_key: 'new-key',
        }),
      );
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.updateProvider('prov_1', {
        name: 'New Name',
        baseUrl: 'http://new:5000',
        apiKey: 'new-key',
      });

      expect(result!.name).toBe('New Name');
      expect(result!.baseUrl).toBe('http://new:5000');
      expect(result!.apiKey).toBe('new-key');
    });

    it('should always include updated_at in SET clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow({ name: 'X' }));
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateProvider('prov_1', { name: 'X' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('updated_at = $');
    });
  });

  // =========================================================================
  // deleteProvider
  // =========================================================================

  describe('deleteProvider', () => {
    beforeEach(async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([makeModelRow()]);
      await repo.initialize();
    });

    it('should delete models first, then provider', async () => {
      // delete models
      mockAdapter.execute.mockResolvedValueOnce({ changes: 2 });
      // delete provider
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.deleteProvider('prov_1');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);

      // First call: delete models
      const sql1 = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql1).toContain('DELETE FROM local_models');
      // Second call: delete provider
      const sql2 = mockAdapter.execute.mock.calls[1]![0] as string;
      expect(sql2).toContain('DELETE FROM local_providers');
    });

    it('should return false when provider not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 }); // delete models
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 }); // delete provider

      const result = await repo.deleteProvider('missing');

      expect(result).toBe(false);
    });

    it('should remove provider and models from cache', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.deleteProvider('prov_1');

      expect(await repo.getProvider('prov_1')).toBeNull();
      const models = await repo.listModels(undefined, 'prov_1');
      expect(models).toEqual([]);
    });
  });

  // =========================================================================
  // setDefault
  // =========================================================================

  describe('setDefault', () => {
    it('should clear existing defaults and set new one', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      // clear existing defaults
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      // set new default
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshCache
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow({ is_default: true })])
        .mockResolvedValueOnce([]);

      await repo.setDefault('user-1', 'prov_1');

      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);

      // First call: clear defaults
      const sql1 = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql1).toContain('is_default = FALSE');
      expect(sql1).toContain('user_id = $1');

      // Second call: set new default
      const sql2 = mockAdapter.execute.mock.calls[1]![0] as string;
      expect(sql2).toContain('is_default = TRUE');
    });
  });

  // =========================================================================
  // listModels
  // =========================================================================

  describe('listModels', () => {
    beforeEach(async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          makeProviderRow({ id: 'prov_1', user_id: 'user-1' }),
          makeProviderRow({ id: 'prov_2', user_id: 'user-2' }),
        ])
        .mockResolvedValueOnce([
          makeModelRow({ id: 'model_1', local_provider_id: 'prov_1', user_id: 'user-1' }),
          makeModelRow({ id: 'model_2', local_provider_id: 'prov_1', user_id: 'user-1', model_id: 'mistral' }),
          makeModelRow({ id: 'model_3', local_provider_id: 'prov_2', user_id: 'user-2', model_id: 'phi' }),
        ]);
      await repo.initialize();
    });

    it('should return all models when no filters', async () => {
      const models = await repo.listModels();
      expect(models).toHaveLength(3);
    });

    it('should filter by providerId', async () => {
      const models = await repo.listModels(undefined, 'prov_1');
      expect(models).toHaveLength(2);
    });

    it('should filter by userId', async () => {
      const models = await repo.listModels('user-2');
      expect(models).toHaveLength(1);
      expect(models[0]!.userId).toBe('user-2');
    });

    it('should filter by both userId and providerId', async () => {
      const models = await repo.listModels('user-1', 'prov_1');
      expect(models).toHaveLength(2);
    });

    it('should return empty when no models for provider', async () => {
      const models = await repo.listModels(undefined, 'nonexistent');
      expect(models).toEqual([]);
    });

    it('should parse model capabilities', async () => {
      const models = await repo.listModels(undefined, 'prov_1');
      expect(models[0]!.capabilities).toEqual(['text']);
    });
  });

  // =========================================================================
  // upsertModel
  // =========================================================================

  describe('upsertModel', () => {
    beforeEach(async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();
    });

    it('should insert a new model via RETURNING', async () => {
      // queryOne (INSERT ... RETURNING)
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelRow());
      // refreshProviderCache
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.query.mockResolvedValueOnce([makeModelRow()]);

      const result = await repo.upsertModel({
        localProviderId: 'prov_1',
        modelId: 'llama3:latest',
        displayName: 'Llama 3',
      });

      expect(result.modelId).toBe('llama3:latest');
      expect(result.displayName).toBe('Llama 3');
      expect(result.isEnabled).toBe(true);
    });

    it('should default capabilities to empty array', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeModelRow({ capabilities: '[]' }),
      );
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.query.mockResolvedValueOnce([makeModelRow()]);

      await repo.upsertModel({
        localProviderId: 'prov_1',
        modelId: 'test',
        displayName: 'Test',
      });

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('[]'); // capabilities
    });

    it('should default contextWindow and maxOutput to 4096', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelRow());
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.query.mockResolvedValueOnce([makeModelRow()]);

      await repo.upsertModel({
        localProviderId: 'prov_1',
        modelId: 'test',
        displayName: 'Test',
      });

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe(4096); // contextWindow
      expect(params[7]).toBe(4096); // maxOutput
    });

    it('should fall back to cache when RETURNING returns null', async () => {
      // queryOne returns null (no RETURNING)
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // refreshProviderCache
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.query.mockResolvedValueOnce([
        makeModelRow({ user_id: 'default', model_id: 'test-model' }),
      ]);

      const result = await repo.upsertModel({
        localProviderId: 'prov_1',
        modelId: 'test-model',
        displayName: 'Test',
      });

      expect(result.modelId).toBe('test-model');
    });

    it('should throw when model not found even after cache refresh', async () => {
      // queryOne returns null
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // refreshProviderCache
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      await expect(
        repo.upsertModel({
          localProviderId: 'prov_1',
          modelId: 'ghost-model',
          displayName: 'Ghost',
        }),
      ).rejects.toThrow('Failed to upsert local model: ghost-model');
    });

    it('should use provided userId instead of default', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeModelRow({ user_id: 'custom-user' }),
      );
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.query.mockResolvedValueOnce([makeModelRow()]);

      await repo.upsertModel({
        localProviderId: 'prov_1',
        modelId: 'test',
        displayName: 'Test',
        userId: 'custom-user',
      });

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('custom-user');
    });

    it('should serialize capabilities and metadata as JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelRow());
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.query.mockResolvedValueOnce([makeModelRow()]);

      await repo.upsertModel({
        localProviderId: 'prov_1',
        modelId: 'test',
        displayName: 'Test',
        capabilities: ['text', 'vision'],
        metadata: { family: 'llama' },
      });

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('["text","vision"]');
      expect(params[9]).toBe('{"family":"llama"}');
    });

    it('should include ON CONFLICT clause for upsert', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelRow());
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.query.mockResolvedValueOnce([makeModelRow()]);

      await repo.upsertModel({
        localProviderId: 'prov_1',
        modelId: 'test',
        displayName: 'Test',
      });

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO UPDATE SET');
      expect(sql).toContain('RETURNING *');
    });
  });

  // =========================================================================
  // toggleModel
  // =========================================================================

  describe('toggleModel', () => {
    beforeEach(async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([makeModelRow()]);
      await repo.initialize();
    });

    it('should update is_enabled and refresh cache', async () => {
      // queryOne to find model
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshProviderCache
      mockAdapter.queryOne.mockResolvedValueOnce(makeProviderRow());
      mockAdapter.query.mockResolvedValueOnce([
        makeModelRow({ is_enabled: false }),
      ]);

      await repo.toggleModel('model_1', false);

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('is_enabled = $1');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(false);
    });

    it('should do nothing when model not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.toggleModel('missing', true);

      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // deleteModelsForProvider
  // =========================================================================

  describe('deleteModelsForProvider', () => {
    beforeEach(async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([makeModelRow(), makeModelRow({ id: 'model_2' })]);
      await repo.initialize();
    });

    it('should delete all models for provider and return count', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 2 });

      const count = await repo.deleteModelsForProvider('prov_1');

      expect(count).toBe(2);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM local_models');
      expect(sql).toContain('local_provider_id = $1');
    });

    it('should return 0 when no models for provider', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const count = await repo.deleteModelsForProvider('unknown');

      expect(count).toBe(0);
    });

    it('should clear models from cache', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 2 });

      await repo.deleteModelsForProvider('prov_1');

      const models = await repo.listModels(undefined, 'prov_1');
      expect(models).toEqual([]);
    });
  });

  // =========================================================================
  // updateDiscoveredAt
  // =========================================================================

  describe('updateDiscoveredAt', () => {
    it('should update last_discovered_at and updated_at', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeProviderRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshProviderCache
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeProviderRow({ last_discovered_at: NOW }),
      );
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateDiscoveredAt('prov_1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('last_discovered_at = $1');
      expect(sql).toContain('updated_at = $2');
    });
  });

  // =========================================================================
  // initializeLocalProvidersRepo
  // =========================================================================

  describe('initializeLocalProvidersRepo', () => {
    it('should be importable', async () => {
      const { initializeLocalProvidersRepo } = await import('./local-providers.js');
      expect(typeof initializeLocalProvidersRepo).toBe('function');
    });
  });
});
