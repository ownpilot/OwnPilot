/**
 * Pricing Routes Tests
 *
 * Integration tests for the model pricing/sync API endpoints.
 * Mocks modelConfigsRepo, core provider functions, fetch, fs, and ws.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockModelConfigsRepo = {
  fullReset: vi.fn(async () => ({ providerConfigs: 3, modelConfigs: 10, customProviders: 2 })),
  listModels: vi.fn(async () => []),
  getDisabledModelIds: vi.fn(async () => new Set<string>()),
  getProvider: vi.fn(async () => null),
  getCustomModels: vi.fn(async () => []),
  listProviders: vi.fn(async () => []),
  upsertModel: vi.fn(async (input: Record<string, unknown>) => input),
};

vi.mock('../../db/repositories/index.js', () => ({
  modelConfigsRepo: mockModelConfigsRepo,
  localProvidersRepo: {
    listProviders: vi.fn(async () => []),
    listModels: vi.fn(async () => []),
  },
}));

const mockBroadcast = vi.fn();
vi.mock('../../ws/server.js', () => ({
  wsGateway: { broadcast: mockBroadcast },
}));

const mockSyncAllProviders = vi.hoisted(() => vi.fn(async () => ({
  synced: ['openai', 'anthropic'],
  failed: [],
  total: 2,
})));
const mockClearConfigCache = vi.hoisted(() => vi.fn());
const mockSyncProviders = vi.hoisted(() => vi.fn(async () => ({
  synced: ['openai'],
  failed: [],
  total: 1,
})));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getAllProviderConfigs: vi.fn(() => [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
        models: [
          { id: 'gpt-4', name: 'GPT-4', inputPrice: 30, outputPrice: 60, capabilities: ['chat'], contextWindow: 8192, maxOutput: 4096 },
        ],
      },
    ]),
    getProviderConfig: vi.fn(() => null),
    getAllAggregatorProviders: vi.fn(() => []),
    getAggregatorProvider: vi.fn(() => null),
    isAggregatorProvider: vi.fn(() => false),
    syncAllProviders: mockSyncAllProviders,
    clearConfigCache: mockClearConfigCache,
    syncProviders: mockSyncProviders,
  };
});

vi.mock('../settings.js', () => ({
  hasApiKey: vi.fn(async () => false),
  getApiKey: vi.fn(async () => null),
  getConfiguredProviderIds: vi.fn(async () => new Set<string>()),
}));

// Import after mocks
const { pricingRoutes } = await import('./pricing.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/pricing', pricingRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pricing Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    app = createApp();
  });

  // ========================================================================
  // POST /sync - Check for changes from models.dev
  // ========================================================================

  describe('POST /pricing/sync', () => {
    it('returns sync stats when models.dev returns data', async () => {
      const modelsDevData = {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4': { id: 'gpt-4', name: 'GPT-4', cost: { input: 30, output: 60 } },
            'gpt-5': { id: 'gpt-5', name: 'GPT-5', cost: { input: 50, output: 100 } },
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => modelsDevData,
      })));

      const res = await app.request('/pricing/sync', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.stats.providers).toBe(1);
      expect(json.data.stats.totalModels).toBe(2);
      expect(json.data.stats.newModels).toBe(1); // gpt-5 is new
      expect(json.data.message).toContain('Sync check complete');

      vi.unstubAllGlobals();
    });

    it('counts updated pricing for existing models with changed costs', async () => {
      const modelsDevData = {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4': { id: 'gpt-4', name: 'GPT-4', cost: { input: 25, output: 50 } }, // changed price
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => modelsDevData,
      })));

      const res = await app.request('/pricing/sync', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.stats.updatedPricing).toBe(1);
      expect(json.data.stats.newModels).toBe(0);

      vi.unstubAllGlobals();
    });

    it('skips providers with no models', async () => {
      const modelsDevData = {
        openai: { id: 'openai', name: 'OpenAI', models: {} },
        empty_provider: { id: 'empty', name: 'Empty' },
      };

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => modelsDevData,
      })));

      const res = await app.request('/pricing/sync', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.stats.totalModels).toBe(0);
      expect(json.data.stats.providers).toBe(2);

      vi.unstubAllGlobals();
    });

    it('handles models without cost data (defaults to 0)', async () => {
      const modelsDevData = {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4': { id: 'gpt-4', name: 'GPT-4' }, // no cost field
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => modelsDevData,
      })));

      const res = await app.request('/pricing/sync', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      // gpt-4 exists with inputPrice: 30 but remote cost is 0 -> should count as pricing update
      expect(json.data.stats.updatedPricing).toBe(1);

      vi.unstubAllGlobals();
    });

    it('returns 500 when fetch fails with non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 503,
      })));

      const res = await app.request('/pricing/sync', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('FETCH_FAILED');
      expect(json.error.message).toContain('503');

      vi.unstubAllGlobals();
    });

    it('returns 500 when fetch throws an error', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('Network unreachable');
      }));

      const res = await app.request('/pricing/sync', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('SYNC_ERROR');

      vi.unstubAllGlobals();
    });
  });

  // ========================================================================
  // POST /sync/apply - Apply sync from models.dev
  // ========================================================================

  describe('POST /pricing/sync/apply', () => {
    it('syncs all providers and clears cache', async () => {
      const res = await app.request('/pricing/sync/apply', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.stats.providers).toBe(2);
      expect(json.data.stats.failed).toBe(0);
      expect(mockSyncAllProviders).toHaveBeenCalled();
      expect(mockClearConfigCache).toHaveBeenCalled();
      expect(mockBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'model_config',
        action: 'updated',
      });
    });

    it('includes synced and failed provider lists', async () => {
      mockSyncAllProviders.mockResolvedValueOnce({
        synced: ['openai'],
        failed: ['anthropic'],
        total: 2,
      });

      const res = await app.request('/pricing/sync/apply', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.stats.syncedProviders).toEqual(['openai']);
      expect(json.data.stats.failedProviders).toEqual(['anthropic']);
    });

    it('returns 500 when sync apply throws', async () => {
      mockSyncAllProviders.mockRejectedValueOnce(new Error('Sync failure'));

      const res = await app.request('/pricing/sync/apply', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('SYNC_ERROR');
      expect(json.error.message).toContain('Sync apply failed');
    });
  });

  // ========================================================================
  // POST /sync/reset - Full reset
  // ========================================================================

  describe('POST /pricing/sync/reset', () => {
    it('clears database, deletes config files, and resyncs', async () => {
      // Mock fs module (dynamic import)
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
        readdirSync: vi.fn(() => []),
        unlinkSync: vi.fn(),
      }));

      const res = await app.request('/pricing/sync/reset', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.stats.database.providerConfigs).toBe(3);
      expect(json.data.stats.database.modelConfigs).toBe(10);
      expect(json.data.stats.database.customProviders).toBe(2);
      expect(json.data.stats.synced).toBe(2);
      expect(mockModelConfigsRepo.fullReset).toHaveBeenCalledWith('default');
      expect(mockClearConfigCache).toHaveBeenCalled();
      expect(mockBroadcast).toHaveBeenCalled();
    });

    it('returns 500 when reset fails', async () => {
      mockModelConfigsRepo.fullReset.mockRejectedValueOnce(new Error('DB error'));

      const res = await app.request('/pricing/sync/reset', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('DELETE_FAILED');
    });
  });

  // ========================================================================
  // DELETE /sync/provider/:id - Delete a provider config
  // ========================================================================

  describe('DELETE /pricing/sync/provider/:id', () => {
    it('returns 400 for invalid provider ID format (path traversal)', async () => {
      const res = await app.request('/pricing/sync/provider/..%2Fetc', { method: 'DELETE' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_REQUEST');
      expect(json.error.message).toContain('Invalid provider ID format');
    });

    it('returns 400 for provider ID with special characters', async () => {
      const res = await app.request('/pricing/sync/provider/a%20b', { method: 'DELETE' });

      expect(res.status).toBe(400);
    });

    it('returns 404 when config file does not exist', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
      }));

      const res = await app.request('/pricing/sync/provider/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });

    it('deletes provider config file without resync', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => true),
        unlinkSync: vi.fn(),
      }));

      const res = await app.request('/pricing/sync/provider/test-provider', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.data.deleted).toBe(true);
      expect(json.data.data.resynced).toBe(false);
      expect(mockClearConfigCache).toHaveBeenCalled();
      expect(mockBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'model_provider',
        action: 'deleted',
        id: 'test-provider',
      });
    });

    it('deletes and resyncs provider when resync=true', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => true),
        unlinkSync: vi.fn(),
      }));

      const res = await app.request('/pricing/sync/provider/test-provider?resync=true', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.data.resynced).toBe(true);
      expect(json.data.message).toContain('resynced');
      expect(mockSyncProviders).toHaveBeenCalledWith(['test-provider']);
    });

    it('returns message without resync when resync param is absent', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => true),
        unlinkSync: vi.fn(),
      }));

      const res = await app.request('/pricing/sync/provider/test-provider', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('Deleted provider');
      expect(json.data.message).not.toContain('resynced');
    });

    it('returns 500 when delete throws an error', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => true),
        unlinkSync: vi.fn(() => { throw new Error('Permission denied'); }),
      }));

      const res = await app.request('/pricing/sync/provider/test-provider', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('DELETE_FAILED');
    });
  });
});
