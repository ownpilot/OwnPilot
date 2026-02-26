/**
 * Model Routing Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSettingsRepo = {
  get: vi.fn(() => null),
  set: vi.fn(async () => {}),
  delete: vi.fn(async () => true),
  deleteByPrefix: vi.fn(async () => 0),
};

vi.mock('../db/repositories/index.js', () => ({
  settingsRepo: null as unknown,
}));

import * as repoModule from '../db/repositories/index.js';
(repoModule as Record<string, unknown>).settingsRepo = mockSettingsRepo;

const mockGetDefaultProvider = vi.fn(async () => 'openai');
const mockGetDefaultModel = vi.fn(async () => 'gpt-4o');

vi.mock('../routes/settings.js', () => ({
  getDefaultProvider: (...args: unknown[]) => mockGetDefaultProvider(...args),
  getDefaultModel: (...args: unknown[]) => mockGetDefaultModel(...args),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  getProcessRouting,
  getAllRouting,
  resolveForProcess,
  setProcessRouting,
  clearProcessRouting,
  isValidProcess,
  VALID_PROCESSES,
} from './model-routing.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('model-routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultProvider.mockResolvedValue('openai');
    mockGetDefaultModel.mockResolvedValue('gpt-4o');
  });

  // ── isValidProcess ──────────────────────────────────────────────────

  describe('isValidProcess', () => {
    it('returns true for valid processes', () => {
      expect(isValidProcess('chat')).toBe(true);
      expect(isValidProcess('telegram')).toBe(true);
      expect(isValidProcess('pulse')).toBe(true);
    });

    it('returns false for invalid processes', () => {
      expect(isValidProcess('scheduler')).toBe(false);
      expect(isValidProcess('')).toBe(false);
      expect(isValidProcess('invalid')).toBe(false);
    });
  });

  describe('VALID_PROCESSES', () => {
    it('contains exactly 3 processes', () => {
      expect(VALID_PROCESSES).toEqual(['chat', 'telegram', 'pulse']);
    });
  });

  // ── getProcessRouting ───────────────────────────────────────────────

  describe('getProcessRouting', () => {
    it('returns nulls when no keys are set', () => {
      mockSettingsRepo.get.mockReturnValue(null);
      const result = getProcessRouting('chat');
      expect(result).toEqual({
        provider: null,
        model: null,
        fallbackProvider: null,
        fallbackModel: null,
      });
    });

    it('returns correct values when keys are set', () => {
      mockSettingsRepo.get.mockImplementation((key: string) => {
        const map: Record<string, string> = {
          'model_routing:chat:provider': 'anthropic',
          'model_routing:chat:model': 'claude-sonnet-4-20250514',
          'model_routing:chat:fallback_provider': 'openai',
          'model_routing:chat:fallback_model': 'gpt-4o',
        };
        return map[key] ?? null;
      });

      const result = getProcessRouting('chat');
      expect(result).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        fallbackProvider: 'openai',
        fallbackModel: 'gpt-4o',
      });
    });

    it('reads the correct keys for each process', () => {
      mockSettingsRepo.get.mockReturnValue(null);
      getProcessRouting('telegram');
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('model_routing:telegram:provider');
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('model_routing:telegram:model');
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('model_routing:telegram:fallback_provider');
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('model_routing:telegram:fallback_model');
    });
  });

  // ── getAllRouting ───────────────────────────────────────────────────

  describe('getAllRouting', () => {
    it('returns routing for all 3 processes', () => {
      mockSettingsRepo.get.mockReturnValue(null);
      const result = getAllRouting();
      expect(result).toHaveProperty('chat');
      expect(result).toHaveProperty('telegram');
      expect(result).toHaveProperty('pulse');
    });
  });

  // ── resolveForProcess ──────────────────────────────────────────────

  describe('resolveForProcess', () => {
    it('returns process config with source=process when provider is set', async () => {
      mockSettingsRepo.get.mockImplementation((key: string) => {
        if (key === 'model_routing:chat:provider') return 'anthropic';
        if (key === 'model_routing:chat:model') return 'claude-sonnet-4-20250514';
        return null;
      });

      const result = await resolveForProcess('chat');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.source).toBe('process');
    });

    it('falls back to global default with source=global when no process config', async () => {
      mockSettingsRepo.get.mockReturnValue(null);
      mockGetDefaultProvider.mockResolvedValue('openai');
      mockGetDefaultModel.mockResolvedValue('gpt-4o');

      const result = await resolveForProcess('chat');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
      expect(result.source).toBe('global');
    });

    it('returns source=first-configured when no global default', async () => {
      mockSettingsRepo.get.mockReturnValue(null);
      mockGetDefaultProvider.mockResolvedValue(null);
      mockGetDefaultModel.mockResolvedValue(null);

      const result = await resolveForProcess('chat');
      expect(result.provider).toBeNull();
      expect(result.source).toBe('first-configured');
    });

    it('resolves model from provider default when only provider is set', async () => {
      mockSettingsRepo.get.mockImplementation((key: string) => {
        if (key === 'model_routing:pulse:provider') return 'anthropic';
        return null;
      });
      mockGetDefaultModel.mockResolvedValue('claude-sonnet-4-20250514');

      const result = await resolveForProcess('pulse');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.source).toBe('process');
      expect(mockGetDefaultModel).toHaveBeenCalledWith('anthropic');
    });

    it('passes through fallback fields independently', async () => {
      mockSettingsRepo.get.mockImplementation((key: string) => {
        if (key === 'model_routing:telegram:fallback_provider') return 'openai';
        if (key === 'model_routing:telegram:fallback_model') return 'gpt-4o-mini';
        return null;
      });

      const result = await resolveForProcess('telegram');
      expect(result.fallbackProvider).toBe('openai');
      expect(result.fallbackModel).toBe('gpt-4o-mini');
      // Primary still falls to global
      expect(result.source).toBe('global');
    });
  });

  // ── setProcessRouting ──────────────────────────────────────────────

  describe('setProcessRouting', () => {
    it('writes correct keys for provider and model', async () => {
      await setProcessRouting('chat', { provider: 'anthropic', model: 'claude-3' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('model_routing:chat:provider', 'anthropic');
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('model_routing:chat:model', 'claude-3');
    });

    it('deletes key when value is null', async () => {
      await setProcessRouting('chat', { provider: null });
      expect(mockSettingsRepo.delete).toHaveBeenCalledWith('model_routing:chat:provider');
    });

    it('deletes key when value is empty string', async () => {
      await setProcessRouting('chat', { model: '' });
      expect(mockSettingsRepo.delete).toHaveBeenCalledWith('model_routing:chat:model');
    });

    it('writes fallback fields correctly', async () => {
      await setProcessRouting('pulse', {
        fallbackProvider: 'openai',
        fallbackModel: 'gpt-4o-mini',
      });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith(
        'model_routing:pulse:fallback_provider',
        'openai'
      );
      expect(mockSettingsRepo.set).toHaveBeenCalledWith(
        'model_routing:pulse:fallback_model',
        'gpt-4o-mini'
      );
    });

    it('skips undefined fields', async () => {
      await setProcessRouting('chat', { provider: 'openai' });
      // Only provider should be set, not model/fallback
      expect(mockSettingsRepo.set).toHaveBeenCalledTimes(1);
      expect(mockSettingsRepo.delete).not.toHaveBeenCalled();
    });
  });

  // ── clearProcessRouting ────────────────────────────────────────────

  describe('clearProcessRouting', () => {
    it('calls deleteByPrefix with correct prefix', async () => {
      await clearProcessRouting('telegram');
      expect(mockSettingsRepo.deleteByPrefix).toHaveBeenCalledWith('model_routing:telegram:');
    });

    it('uses the right prefix for each process', async () => {
      await clearProcessRouting('chat');
      expect(mockSettingsRepo.deleteByPrefix).toHaveBeenCalledWith('model_routing:chat:');

      await clearProcessRouting('pulse');
      expect(mockSettingsRepo.deleteByPrefix).toHaveBeenCalledWith('model_routing:pulse:');
    });
  });
});
