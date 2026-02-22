/**
 * Model Configs Repository Tests
 *
 * Unit tests for ModelConfigsRepository covering model configs CRUD,
 * custom providers CRUD, user provider configs CRUD, toggles, and resets.
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

import { ModelConfigsRepository } from './model-configs.js';

// ---------------------------------------------------------------------------
// Sample data helpers
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeModelConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mc-1',
    user_id: 'default',
    provider_id: 'openai',
    model_id: 'gpt-4',
    display_name: 'GPT-4',
    capabilities: '["chat","code"]',
    pricing_input: 30,
    pricing_output: 60,
    context_window: 128000,
    max_output: 8192,
    is_enabled: true,
    is_custom: false,
    config: '{"temperature":0.7}',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeCustomProviderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cp-1',
    user_id: 'default',
    provider_id: 'together-ai',
    display_name: 'Together AI',
    api_base_url: 'https://api.together.xyz/v1',
    api_key_setting: 'TOGETHER_API_KEY',
    provider_type: 'openai_compatible',
    is_enabled: true,
    config: '{}',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeUserProviderConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'upc-1',
    user_id: 'default',
    provider_id: 'openai',
    base_url: 'https://custom.openai.example.com',
    provider_type: 'openai_compatible',
    is_enabled: true,
    api_key_env: 'OPENAI_API_KEY',
    notes: 'Custom endpoint',
    config: '{"timeout":30}',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelConfigsRepository', () => {
  let repo: ModelConfigsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ModelConfigsRepository();
  });

  // =========================================================================
  // Model Configs CRUD
  // =========================================================================

  describe('listModels', () => {
    it('should return all model configs for default user', async () => {
      const row = makeModelConfigRow();
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.listModels();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('mc-1');
      expect(result[0].providerId).toBe('openai');
      expect(result[0].modelId).toBe('gpt-4');
      expect(result[0].capabilities).toEqual(['chat', 'code']);
      expect(result[0].config).toEqual({ temperature: 0.7 });
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('ORDER BY provider_id, model_id');
    });

    it('should filter by providerId when given', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listModels('user-1', 'anthropic');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('provider_id = $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1', 'anthropic']);
    });

    it('should return empty array when no configs exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listModels();

      expect(result).toEqual([]);
    });

    it('should use default userId when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listModels();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default']);
    });

    it('should parse JSON capabilities and config from strings', async () => {
      const row = makeModelConfigRow({
        capabilities: '["vision","chat"]',
        config: '{"stream":true}',
      });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.listModels();

      expect(result[0].capabilities).toEqual(['vision', 'chat']);
      expect(result[0].config).toEqual({ stream: true });
    });

    it('should handle already-parsed capabilities and config', async () => {
      const row = makeModelConfigRow({
        capabilities: ['vision', 'chat'],
        config: { stream: true },
      });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.listModels();

      expect(result[0].capabilities).toEqual(['vision', 'chat']);
      expect(result[0].config).toEqual({ stream: true });
    });

    it('should parse dates as Date objects', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeModelConfigRow()]);

      const result = await repo.listModels();

      expect(result[0].createdAt).toBeInstanceOf(Date);
      expect(result[0].updatedAt).toBeInstanceOf(Date);
    });

    it('should convert null optional fields to undefined', async () => {
      const row = makeModelConfigRow({
        display_name: null,
        pricing_input: null,
        pricing_output: null,
        context_window: null,
        max_output: null,
      });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.listModels();

      expect(result[0].displayName).toBeUndefined();
      expect(result[0].pricingInput).toBeUndefined();
      expect(result[0].pricingOutput).toBeUndefined();
      expect(result[0].contextWindow).toBeUndefined();
      expect(result[0].maxOutput).toBeUndefined();
    });
  });

  describe('getModel', () => {
    it('should return a model config when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());

      const result = await repo.getModel('default', 'openai', 'gpt-4');

      expect(result).not.toBeNull();
      expect(result!.modelId).toBe('gpt-4');
      expect(result!.providerId).toBe('openai');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getModel('default', 'openai', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should query with correct WHERE clause', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getModel('user-1', 'anthropic', 'claude-3');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('provider_id = $2');
      expect(sql).toContain('model_id = $3');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1', 'anthropic', 'claude-3']);
    });
  });

  describe('upsertModel', () => {
    it('should insert a new model config when none exists', async () => {
      // getModel returns null (no existing)
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // execute insert
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getModel after insert
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());

      const result = await repo.upsertModel({
        providerId: 'openai',
        modelId: 'gpt-4',
        displayName: 'GPT-4',
        capabilities: ['chat', 'code'],
        pricingInput: 30,
        pricingOutput: 60,
      });

      expect(result.modelId).toBe('gpt-4');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO user_model_configs');
    });

    it('should update an existing model config', async () => {
      // getModel returns existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getModel after update
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeModelConfigRow({ display_name: 'Updated GPT-4' })
      );

      const result = await repo.upsertModel({
        providerId: 'openai',
        modelId: 'gpt-4',
        displayName: 'Updated GPT-4',
      });

      expect(result.displayName).toBe('Updated GPT-4');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE user_model_configs');
    });

    it('should use default userId when not provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());

      await repo.upsertModel({ providerId: 'openai', modelId: 'gpt-4' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('default');
    });

    it('should throw when getModel returns null after insert', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null); // no existing
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 }); // insert
      mockAdapter.queryOne.mockResolvedValueOnce(null); // getModel fails

      await expect(repo.upsertModel({ providerId: 'openai', modelId: 'gpt-4' })).rejects.toThrow(
        'Failed to upsert model config'
      );
    });

    it('should throw when getModel returns null after update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow()); // existing found
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 }); // update
      mockAdapter.queryOne.mockResolvedValueOnce(null); // getModel fails

      await expect(repo.upsertModel({ providerId: 'openai', modelId: 'gpt-4' })).rejects.toThrow(
        'Failed to upsert model config'
      );
    });

    it('should serialize capabilities and config as JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());

      await repo.upsertModel({
        providerId: 'openai',
        modelId: 'gpt-4',
        capabilities: ['chat', 'vision'],
        config: { temperature: 0.5 },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('["chat","vision"]');
      expect(params[12]).toBe('{"temperature":0.5}');
    });

    it('should default capabilities to empty array and config to empty object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeModelConfigRow({ capabilities: '[]', config: '{}' })
      );

      await repo.upsertModel({ providerId: 'openai', modelId: 'gpt-4' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('[]');
      expect(params[12]).toBe('{}');
    });

    it('should default isEnabled to true and isCustom to false', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());

      await repo.upsertModel({ providerId: 'openai', modelId: 'gpt-4' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // isEnabled !== false => true (index 10)
      expect(params[10]).toBe(true);
      // isCustom || false => false (index 11)
      expect(params[11]).toBe(false);
    });
  });

  describe('updateModel', () => {
    it('should update and return the updated model config', async () => {
      // getModel existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());
      // execute
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getModel after update
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow({ display_name: 'New Name' }));

      const result = await repo.updateModel('default', 'openai', 'gpt-4', {
        displayName: 'New Name',
      });

      expect(result).not.toBeNull();
      expect(result!.displayName).toBe('New Name');
    });

    it('should return null if model does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.updateModel('default', 'openai', 'gpt-4', {
        displayName: 'x',
      });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should pass COALESCE values for partial updates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());

      await repo.updateModel('default', 'openai', 'gpt-4', {
        pricingInput: 50,
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('COALESCE');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // pricingInput is at index 2
      expect(params[2]).toBe(50);
    });

    it('should serialize capabilities and config when provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeModelConfigRow());

      await repo.updateModel('default', 'openai', 'gpt-4', {
        capabilities: ['chat'],
        config: { k: 'v' },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('["chat"]');
      expect(params[7]).toBe('{"k":"v"}');
    });
  });

  describe('deleteModel', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.deleteModel('default', 'openai', 'gpt-4');

      expect(result).toBe(true);
    });

    it('should return false when model not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteModel('default', 'openai', 'nonexistent');

      expect(result).toBe(false);
    });

    it('should use correct WHERE clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.deleteModel('user-1', 'anthropic', 'claude-3');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM user_model_configs');
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('provider_id = $2');
      expect(sql).toContain('model_id = $3');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1', 'anthropic', 'claude-3']);
    });
  });

  describe('toggleModel', () => {
    it('should update is_enabled and return true', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.toggleModel('default', 'openai', 'gpt-4', false);

      expect(result).toBe(true);
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(false);
    });

    it('should return false when model not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.toggleModel('default', 'openai', 'nonexistent', true);

      expect(result).toBe(false);
    });
  });

  describe('getEnabledModelIds', () => {
    it('should return a Set of "provider/model" strings', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { provider_id: 'openai', model_id: 'gpt-4' },
        { provider_id: 'anthropic', model_id: 'claude-3' },
      ]);

      const result = await repo.getEnabledModelIds();

      expect(result).toBeInstanceOf(Set);
      expect(result.has('openai/gpt-4')).toBe(true);
      expect(result.has('anthropic/claude-3')).toBe(true);
      expect(result.size).toBe(2);
    });

    it('should return empty Set when no enabled models', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getEnabledModelIds();

      expect(result.size).toBe(0);
    });

    it('should filter by is_enabled = true', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getEnabledModelIds('user-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_enabled = true');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1']);
    });

    it('should use default userId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getEnabledModelIds();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default']);
    });
  });

  describe('getDisabledModelIds', () => {
    it('should return a Set of disabled model IDs', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ provider_id: 'openai', model_id: 'gpt-3.5' }]);

      const result = await repo.getDisabledModelIds();

      expect(result.has('openai/gpt-3.5')).toBe(true);
    });

    it('should filter by is_enabled = false', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getDisabledModelIds();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_enabled = false');
    });
  });

  describe('getCustomModels', () => {
    it('should return only custom models', async () => {
      const row = makeModelConfigRow({ is_custom: true });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.getCustomModels();

      expect(result).toHaveLength(1);
      expect(result[0].isCustom).toBe(true);
    });

    it('should filter by is_custom = true', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getCustomModels();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_custom = true');
    });

    it('should return empty array when no custom models', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getCustomModels();

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // Custom Providers CRUD
  // =========================================================================

  describe('listProviders', () => {
    it('should return all custom providers for default user', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeCustomProviderRow()]);

      const result = await repo.listProviders();

      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('together-ai');
      expect(result[0].displayName).toBe('Together AI');
      expect(result[0].providerType).toBe('openai_compatible');
    });

    it('should return empty array when no providers exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listProviders();

      expect(result).toEqual([]);
    });

    it('should order by display_name', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listProviders();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY display_name');
    });

    it('should parse JSON config field', async () => {
      const row = makeCustomProviderRow({ config: '{"rateLimit":100}' });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.listProviders();

      expect(result[0].config).toEqual({ rateLimit: 100 });
    });

    it('should convert null optional fields to undefined', async () => {
      const row = makeCustomProviderRow({
        api_base_url: null,
        api_key_setting: null,
      });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.listProviders();

      expect(result[0].apiBaseUrl).toBeUndefined();
      expect(result[0].apiKeySetting).toBeUndefined();
    });
  });

  describe('getProvider', () => {
    it('should return a provider when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCustomProviderRow());

      const result = await repo.getProvider('default', 'together-ai');

      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('together-ai');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getProvider('default', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('upsertProvider', () => {
    it('should insert a new provider when none exists', async () => {
      // getProvider returns null
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // execute insert
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getProvider after insert
      mockAdapter.queryOne.mockResolvedValueOnce(makeCustomProviderRow());

      const result = await repo.upsertProvider({
        providerId: 'together-ai',
        displayName: 'Together AI',
        apiBaseUrl: 'https://api.together.xyz/v1',
      });

      expect(result.providerId).toBe('together-ai');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO custom_providers');
    });

    it('should update an existing provider', async () => {
      // getProvider returns existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeCustomProviderRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getProvider after update
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCustomProviderRow({ display_name: 'Updated' })
      );

      const result = await repo.upsertProvider({
        providerId: 'together-ai',
        displayName: 'Updated',
      });

      expect(result.displayName).toBe('Updated');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE custom_providers');
    });

    it('should throw when getProvider returns null after insert', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null); // no existing
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 }); // insert
      mockAdapter.queryOne.mockResolvedValueOnce(null); // getProvider fails

      await expect(repo.upsertProvider({ providerId: 'x', displayName: 'X' })).rejects.toThrow(
        'Failed to upsert provider'
      );
    });

    it('should default providerType to openai_compatible', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCustomProviderRow());

      await repo.upsertProvider({ providerId: 'test', displayName: 'Test' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe('openai_compatible');
    });

    it('should default isEnabled to true', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCustomProviderRow());

      await repo.upsertProvider({ providerId: 'test', displayName: 'Test' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[7]).toBe(true);
    });

    it('should serialize config as JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCustomProviderRow());

      await repo.upsertProvider({
        providerId: 'test',
        displayName: 'Test',
        config: { key: 'value' },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[8]).toBe('{"key":"value"}');
    });
  });

  describe('updateProvider', () => {
    it('should update and return the provider', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCustomProviderRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCustomProviderRow({ display_name: 'Renamed' })
      );

      const result = await repo.updateProvider('default', 'together-ai', {
        displayName: 'Renamed',
      });

      expect(result).not.toBeNull();
      expect(result!.displayName).toBe('Renamed');
    });

    it('should return null if provider does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.updateProvider('default', 'missing', {
        displayName: 'x',
      });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteProvider', () => {
    it('should delete provider and its models', async () => {
      // Delete models first, then delete provider
      mockAdapter.execute.mockResolvedValueOnce({ changes: 2 }); // delete models
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 }); // delete provider

      const result = await repo.deleteProvider('default', 'together-ai');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);

      const sql1 = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql1).toContain('DELETE FROM user_model_configs');

      const sql2 = mockAdapter.execute.mock.calls[1]![0] as string;
      expect(sql2).toContain('DELETE FROM custom_providers');
    });

    it('should return false when provider not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 }); // delete models
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 }); // delete provider

      const result = await repo.deleteProvider('default', 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('toggleProvider', () => {
    it('should toggle provider enabled status', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.toggleProvider('default', 'together-ai', false);

      expect(result).toBe(true);
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(false);
    });

    it('should return false when provider not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.toggleProvider('default', 'missing', true);

      expect(result).toBe(false);
    });
  });

  describe('getEnabledProviderIds', () => {
    it('should return a Set of enabled provider IDs', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { provider_id: 'together-ai' },
        { provider_id: 'fal-ai' },
      ]);

      const result = await repo.getEnabledProviderIds();

      expect(result).toBeInstanceOf(Set);
      expect(result.has('together-ai')).toBe(true);
      expect(result.has('fal-ai')).toBe(true);
    });

    it('should return empty Set when none enabled', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getEnabledProviderIds();

      expect(result.size).toBe(0);
    });
  });

  // =========================================================================
  // User Provider Configs CRUD
  // =========================================================================

  describe('listUserProviderConfigs', () => {
    it('should return all user provider configs', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeUserProviderConfigRow()]);

      const result = await repo.listUserProviderConfigs();

      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('openai');
      expect(result[0].baseUrl).toBe('https://custom.openai.example.com');
      expect(result[0].config).toEqual({ timeout: 30 });
    });

    it('should order by provider_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listUserProviderConfigs();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY provider_id');
    });

    it('should convert null fields to undefined', async () => {
      const row = makeUserProviderConfigRow({
        base_url: null,
        provider_type: null,
        api_key_env: null,
        notes: null,
      });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.listUserProviderConfigs();

      expect(result[0].baseUrl).toBeUndefined();
      expect(result[0].providerType).toBeUndefined();
      expect(result[0].apiKeyEnv).toBeUndefined();
      expect(result[0].notes).toBeUndefined();
    });
  });

  describe('getUserProviderConfig', () => {
    it('should return config when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserProviderConfigRow());

      const result = await repo.getUserProviderConfig('default', 'openai');

      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('openai');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getUserProviderConfig('default', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('upsertUserProviderConfig', () => {
    it('should insert when no existing config', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null); // no existing
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserProviderConfigRow());

      const result = await repo.upsertUserProviderConfig({
        providerId: 'openai',
        baseUrl: 'https://custom.openai.example.com',
      });

      expect(result.providerId).toBe('openai');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO user_provider_configs');
    });

    it('should update when existing config found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserProviderConfigRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserProviderConfigRow({ base_url: 'https://new.url' })
      );

      const result = await repo.upsertUserProviderConfig({
        providerId: 'openai',
        baseUrl: 'https://new.url',
      });

      expect(result.baseUrl).toBe('https://new.url');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE user_provider_configs');
    });

    it('should throw when config not found after upsert', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.upsertUserProviderConfig({ providerId: 'openai' })).rejects.toThrow(
        'Failed to upsert user provider config'
      );
    });

    it('should default isEnabled to true', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserProviderConfigRow());

      await repo.upsertUserProviderConfig({ providerId: 'openai' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe(true); // isEnabled !== false
    });
  });

  describe('updateUserProviderConfig', () => {
    it('should update and return the config', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserProviderConfigRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserProviderConfigRow({ notes: 'Updated notes' })
      );

      const result = await repo.updateUserProviderConfig('default', 'openai', {
        notes: 'Updated notes',
      });

      expect(result).not.toBeNull();
      expect(result!.notes).toBe('Updated notes');
    });

    it('should return null if config does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.updateUserProviderConfig('default', 'missing', {
        notes: 'x',
      });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteUserProviderConfig', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.deleteUserProviderConfig('default', 'openai');

      expect(result).toBe(true);
    });

    it('should return false when config not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteUserProviderConfig('default', 'missing');

      expect(result).toBe(false);
    });
  });

  describe('toggleUserProviderConfig', () => {
    it('should toggle existing config', async () => {
      // getUserProviderConfig returns existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserProviderConfigRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.toggleUserProviderConfig('default', 'openai', false);

      expect(result).toBe(true);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE user_provider_configs');
    });

    it('should create config when not existing and toggle', async () => {
      // getUserProviderConfig returns null (no existing)
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // upsertUserProviderConfig: getUserProviderConfig again (inside upsert)
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // execute insert
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getUserProviderConfig after insert
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserProviderConfigRow({ is_enabled: false }));

      const result = await repo.toggleUserProviderConfig('default', 'openai', false);

      expect(result).toBe(true);
    });

    it('should return false when update changes nothing', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserProviderConfigRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.toggleUserProviderConfig('default', 'openai', true);

      expect(result).toBe(false);
    });
  });

  describe('getDisabledBuiltinProviderIds', () => {
    it('should return disabled provider IDs as a Set', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { provider_id: 'google' },
        { provider_id: 'anthropic' },
      ]);

      const result = await repo.getDisabledBuiltinProviderIds();

      expect(result).toBeInstanceOf(Set);
      expect(result.has('google')).toBe(true);
      expect(result.has('anthropic')).toBe(true);
    });

    it('should filter by is_enabled = false', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getDisabledBuiltinProviderIds();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_enabled = false');
    });
  });

  describe('getProviderOverride', () => {
    it('should return override when config exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserProviderConfigRow());

      const result = await repo.getProviderOverride('default', 'openai');

      expect(result).not.toBeNull();
      expect(result!.baseUrl).toBe('https://custom.openai.example.com');
      expect(result!.providerType).toBe('openai_compatible');
    });

    it('should return null when no config exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getProviderOverride('default', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Bulk delete / Reset
  // =========================================================================

  describe('deleteAllUserProviderConfigs', () => {
    it('should return count of deleted rows', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 5 });

      const result = await repo.deleteAllUserProviderConfigs();

      expect(result).toBe(5);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM user_provider_configs');
    });

    it('should return 0 when none deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteAllUserProviderConfigs();

      expect(result).toBe(0);
    });

    it('should use default userId', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.deleteAllUserProviderConfigs();

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default']);
    });
  });

  describe('deleteAllUserModelConfigs', () => {
    it('should return count of deleted rows', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 10 });

      const result = await repo.deleteAllUserModelConfigs();

      expect(result).toBe(10);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM user_model_configs');
    });
  });

  describe('deleteAllCustomProviders', () => {
    it('should return count of deleted rows', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 3 });

      const result = await repo.deleteAllCustomProviders();

      expect(result).toBe(3);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM custom_providers');
    });
  });

  describe('fullReset', () => {
    it('should delete all configs and return counts', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 2 }); // provider configs
      mockAdapter.execute.mockResolvedValueOnce({ changes: 5 }); // model configs
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 }); // custom providers

      const result = await repo.fullReset();

      expect(result).toEqual({
        providerConfigs: 2,
        modelConfigs: 5,
        customProviders: 1,
      });
      expect(mockAdapter.execute).toHaveBeenCalledTimes(3);
    });

    it('should return zeros when nothing to delete', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.fullReset();

      expect(result).toEqual({
        providerConfigs: 0,
        modelConfigs: 0,
        customProviders: 0,
      });
    });

    it('should use specified userId', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.fullReset('user-42');

      for (let i = 0; i < 3; i++) {
        const params = mockAdapter.execute.mock.calls[i]![1] as unknown[];
        expect(params).toEqual(['user-42']);
      }
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createModelConfigsRepository', () => {
    it('should be importable and return a ModelConfigsRepository', async () => {
      const { createModelConfigsRepository } = await import('./model-configs.js');
      const r = createModelConfigsRepository();
      expect(r).toBeInstanceOf(ModelConfigsRepository);
    });
  });
});
