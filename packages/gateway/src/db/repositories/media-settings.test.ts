/**
 * Media Settings Repository Tests
 *
 * Unit tests for MediaSettingsRepository covering CRUD, effective settings,
 * defaults, available providers, and reset functionality.
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

import {
  MediaSettingsRepository,
  DEFAULT_PROVIDERS,
  AVAILABLE_PROVIDERS,
} from './media-settings.js';
import type { MediaCapability } from './media-settings.js';

// ---------------------------------------------------------------------------
// Sample data helpers
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeMediaSettingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ms-1',
    user_id: 'default',
    capability: 'image_generation',
    provider: 'openai',
    model: 'dall-e-3',
    config: '{}',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MediaSettingsRepository', () => {
  let repo: MediaSettingsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new MediaSettingsRepository();
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return a setting when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMediaSettingRow());

      const result = await repo.get('default', 'image_generation');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('ms-1');
      expect(result!.capability).toBe('image_generation');
      expect(result!.provider).toBe('openai');
      expect(result!.model).toBe('dall-e-3');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.get('default', 'image_generation');

      expect(result).toBeNull();
    });

    it('should parse dates as Date objects', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMediaSettingRow());

      const result = await repo.get('default', 'image_generation');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('should parse JSON config from string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMediaSettingRow({ config: '{"quality":"hd","size":"1024x1024"}' })
      );

      const result = await repo.get('default', 'image_generation');

      expect(result!.config).toEqual({ quality: 'hd', size: '1024x1024' });
    });

    it('should handle already-parsed config object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMediaSettingRow({ config: { quality: 'standard' } })
      );

      const result = await repo.get('default', 'image_generation');

      expect(result!.config).toEqual({ quality: 'standard' });
    });

    it('should convert null model to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMediaSettingRow({ model: null })
      );

      const result = await repo.get('default', 'image_generation');

      expect(result!.model).toBeUndefined();
    });

    it('should query with correct parameters', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.get('user-1', 'tts');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('capability = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1', 'tts']);
    });
  });

  // =========================================================================
  // getEffective
  // =========================================================================

  describe('getEffective', () => {
    it('should return user setting when one exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMediaSettingRow({
          provider: 'fireworks',
          model: 'flux-1-pro',
          config: '{"format":"png"}',
        })
      );

      const result = await repo.getEffective('default', 'image_generation');

      expect(result.provider).toBe('fireworks');
      expect(result.model).toBe('flux-1-pro');
      expect(result.config).toEqual({ format: 'png' });
    });

    it('should return default when no user setting exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getEffective('default', 'image_generation');

      expect(result.provider).toBe('openai');
      expect(result.model).toBe('dall-e-3');
      expect(result.config).toEqual({});
    });

    it('should return correct defaults for each capability', async () => {
      const capabilities: MediaCapability[] = ['image_generation', 'vision', 'tts', 'stt', 'weather'];

      for (const cap of capabilities) {
        mockAdapter.queryOne.mockResolvedValueOnce(null);
        const result = await repo.getEffective('default', cap);
        const expected = DEFAULT_PROVIDERS[cap];
        expect(result.provider).toBe(expected.provider);
        expect(result.model).toBe(expected.model);
      }
    });

    it('should return empty config for defaults', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getEffective('default', 'weather');

      expect(result.config).toEqual({});
    });
  });

  // =========================================================================
  // set
  // =========================================================================

  describe('set', () => {
    it('should insert a new setting when none exists', async () => {
      // get returns null (no existing)
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // execute insert
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // get after insert
      mockAdapter.queryOne.mockResolvedValueOnce(makeMediaSettingRow());

      const result = await repo.set({
        capability: 'image_generation',
        provider: 'openai',
        model: 'dall-e-3',
      });

      expect(result.provider).toBe('openai');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO media_provider_settings');
    });

    it('should update an existing setting', async () => {
      // get returns existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeMediaSettingRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // get after update
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMediaSettingRow({ provider: 'fireworks', model: 'flux-1-pro' })
      );

      const result = await repo.set({
        capability: 'image_generation',
        provider: 'fireworks',
        model: 'flux-1-pro',
      });

      expect(result.provider).toBe('fireworks');
      expect(result.model).toBe('flux-1-pro');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE media_provider_settings');
    });

    it('should use default userId when not provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeMediaSettingRow());

      await repo.set({
        capability: 'image_generation',
        provider: 'openai',
      });

      // Insert params: userId at index 1
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('default');
    });

    it('should throw when get returns null after upsert (insert)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null); // no existing
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 }); // insert
      mockAdapter.queryOne.mockResolvedValueOnce(null); // get fails

      await expect(
        repo.set({ capability: 'image_generation', provider: 'openai' })
      ).rejects.toThrow('Failed to upsert media setting');
    });

    it('should throw when get returns null after upsert (update)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMediaSettingRow()); // existing
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 }); // update
      mockAdapter.queryOne.mockResolvedValueOnce(null); // get fails

      await expect(
        repo.set({ capability: 'image_generation', provider: 'openai' })
      ).rejects.toThrow('Failed to upsert media setting');
    });

    it('should serialize config as JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeMediaSettingRow());

      await repo.set({
        capability: 'image_generation',
        provider: 'openai',
        config: { quality: 'hd', size: '1024x1024' },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('{"quality":"hd","size":"1024x1024"}');
    });

    it('should default config to empty object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeMediaSettingRow());

      await repo.set({
        capability: 'image_generation',
        provider: 'openai',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('{}');
    });

    it('should set null model when not provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeMediaSettingRow({ model: null }));

      await repo.set({
        capability: 'weather',
        provider: 'openweathermap',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[4]).toBeNull(); // model
    });
  });

  // =========================================================================
  // listByUser
  // =========================================================================

  describe('listByUser', () => {
    it('should return all settings for a user', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMediaSettingRow({ capability: 'image_generation' }),
        makeMediaSettingRow({ id: 'ms-2', capability: 'tts', provider: 'elevenlabs', model: 'eleven_multilingual_v2' }),
      ]);

      const result = await repo.listByUser();

      expect(result).toHaveLength(2);
      expect(result[0].capability).toBe('image_generation');
      expect(result[1].capability).toBe('tts');
    });

    it('should return empty array when no settings', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listByUser();

      expect(result).toEqual([]);
    });

    it('should order by capability', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listByUser();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY capability');
    });

    it('should use default userId when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listByUser();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default']);
    });

    it('should use custom userId when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listByUser('user-42');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-42']);
    });
  });

  // =========================================================================
  // getAllEffective
  // =========================================================================

  describe('getAllEffective', () => {
    it('should return effective settings for all 5 capabilities', async () => {
      // 5 calls to getEffective -> 5 queryOne calls, all returning null (defaults)
      mockAdapter.queryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await repo.getAllEffective();

      expect(Object.keys(result)).toHaveLength(5);
      expect(result.image_generation.provider).toBe('openai');
      expect(result.vision.provider).toBe('openai');
      expect(result.tts.provider).toBe('openai');
      expect(result.stt.provider).toBe('openai');
      expect(result.weather.provider).toBe('openweathermap');
    });

    it('should mix user settings with defaults', async () => {
      // image_generation: user setting
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMediaSettingRow({ provider: 'fireworks', model: 'flux-1-pro', config: '{}' })
      );
      // vision, tts, stt, weather: defaults
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getAllEffective();

      expect(result.image_generation.provider).toBe('fireworks');
      expect(result.image_generation.model).toBe('flux-1-pro');
      expect(result.vision.provider).toBe('openai');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('default', 'image_generation');

      expect(result).toBe(true);
    });

    it('should return false when setting not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('default', 'image_generation');

      expect(result).toBe(false);
    });

    it('should use correct WHERE clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('user-1', 'tts');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM media_provider_settings');
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('capability = $2');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1', 'tts']);
    });
  });

  // =========================================================================
  // resetToDefaults
  // =========================================================================

  describe('resetToDefaults', () => {
    it('should delete all settings for a user', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 5 });

      await repo.resetToDefaults();

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM media_provider_settings');
      expect(sql).toContain('user_id = $1');
    });

    it('should use default userId when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.resetToDefaults();

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default']);
    });

    it('should use custom userId when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.resetToDefaults('user-42');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-42']);
    });
  });

  // =========================================================================
  // getAvailableProviders
  // =========================================================================

  describe('getAvailableProviders', () => {
    it('should return providers for image_generation', () => {
      const providers = repo.getAvailableProviders('image_generation');

      expect(providers.length).toBeGreaterThan(0);
      const providerNames = providers.map(p => p.provider);
      expect(providerNames).toContain('openai');
      expect(providerNames).toContain('fireworks');
      expect(providerNames).toContain('replicate');
    });

    it('should return providers for vision', () => {
      const providers = repo.getAvailableProviders('vision');

      expect(providers.length).toBeGreaterThan(0);
      const providerNames = providers.map(p => p.provider);
      expect(providerNames).toContain('openai');
      expect(providerNames).toContain('anthropic');
      expect(providerNames).toContain('google');
    });

    it('should return providers for tts', () => {
      const providers = repo.getAvailableProviders('tts');

      expect(providers.length).toBeGreaterThan(0);
      const providerNames = providers.map(p => p.provider);
      expect(providerNames).toContain('openai');
      expect(providerNames).toContain('elevenlabs');
    });

    it('should return providers for stt', () => {
      const providers = repo.getAvailableProviders('stt');

      expect(providers.length).toBeGreaterThan(0);
      const providerNames = providers.map(p => p.provider);
      expect(providerNames).toContain('openai');
      expect(providerNames).toContain('groq');
      expect(providerNames).toContain('deepgram');
    });

    it('should return providers for weather', () => {
      const providers = repo.getAvailableProviders('weather');

      expect(providers.length).toBeGreaterThan(0);
      const providerNames = providers.map(p => p.provider);
      expect(providerNames).toContain('openweathermap');
      expect(providerNames).toContain('weatherapi');
    });

    it('should include apiKeyEnv and requiresApiKey', () => {
      const providers = repo.getAvailableProviders('image_generation');
      const openai = providers.find(p => p.provider === 'openai');

      expect(openai).toBeDefined();
      expect(openai!.apiKeyEnv).toBe('OPENAI_API_KEY');
      expect(openai!.requiresApiKey).toBe(true);
    });

    it('should include models with default flag', () => {
      const providers = repo.getAvailableProviders('image_generation');
      const openai = providers.find(p => p.provider === 'openai');

      expect(openai!.models).toBeDefined();
      expect(openai!.models!.length).toBeGreaterThan(0);
      const defaultModel = openai!.models!.find(m => m.default);
      expect(defaultModel).toBeDefined();
      expect(defaultModel!.id).toBe('dall-e-3');
    });

    it('should return empty array for unknown capability', () => {
      // Cast to bypass type checking for this edge case test
      const providers = repo.getAvailableProviders('nonexistent' as MediaCapability);

      expect(providers).toEqual([]);
    });
  });

  // =========================================================================
  // getAllAvailableProviders
  // =========================================================================

  describe('getAllAvailableProviders', () => {
    it('should return providers for all capabilities', () => {
      const all = repo.getAllAvailableProviders();

      expect(Object.keys(all)).toHaveLength(5);
      expect(all.image_generation).toBeDefined();
      expect(all.vision).toBeDefined();
      expect(all.tts).toBeDefined();
      expect(all.stt).toBeDefined();
      expect(all.weather).toBeDefined();
    });

    it('should return the same data as AVAILABLE_PROVIDERS', () => {
      const all = repo.getAllAvailableProviders();

      expect(all).toEqual(AVAILABLE_PROVIDERS);
    });
  });

  // =========================================================================
  // DEFAULT_PROVIDERS constants
  // =========================================================================

  describe('DEFAULT_PROVIDERS', () => {
    it('should define defaults for all capabilities', () => {
      expect(DEFAULT_PROVIDERS.image_generation).toEqual({ provider: 'openai', model: 'dall-e-3' });
      expect(DEFAULT_PROVIDERS.vision).toEqual({ provider: 'openai', model: 'gpt-4o' });
      expect(DEFAULT_PROVIDERS.tts).toEqual({ provider: 'openai', model: 'tts-1' });
      expect(DEFAULT_PROVIDERS.stt).toEqual({ provider: 'openai', model: 'whisper-1' });
      expect(DEFAULT_PROVIDERS.weather).toEqual({ provider: 'openweathermap' });
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createMediaSettingsRepository', () => {
    it('should be importable and return a MediaSettingsRepository', async () => {
      const { createMediaSettingsRepository } = await import('./media-settings.js');
      const r = createMediaSettingsRepository();
      expect(r).toBeInstanceOf(MediaSettingsRepository);
    });
  });
});
