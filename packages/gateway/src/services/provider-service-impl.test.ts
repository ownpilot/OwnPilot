/**
 * ProviderService Implementation Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../routes/settings.js', () => ({
  resolveProviderAndModel: vi.fn(async (provider: string, model: string) => ({
    provider: provider === 'default' ? 'openai' : provider,
    model: model === 'default' ? 'gpt-4o-mini' : model,
  })),
  getDefaultProvider: vi.fn(async () => 'openai'),
  getDefaultModel: vi.fn(async () => 'gpt-4o-mini'),
  setDefaultProvider: vi.fn(async () => {}),
  setDefaultModel: vi.fn(async () => {}),
  hasApiKey: vi.fn(async () => true),
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { ProviderService, createProviderService } from './provider-service-impl.js';
import {
  resolveProviderAndModel,
  getDefaultProvider,
  setDefaultProvider,
  setDefaultModel,
} from '../routes/settings.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolve', () => {
    it('delegates to resolveProviderAndModel', async () => {
      const svc = new ProviderService();
      const result = await svc.resolve({ provider: 'anthropic', model: 'claude-3' });
      expect(resolveProviderAndModel).toHaveBeenCalledWith('anthropic', 'claude-3');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-3');
    });

    it('uses defaults when options omitted', async () => {
      const svc = new ProviderService();
      await svc.resolve();
      expect(resolveProviderAndModel).toHaveBeenCalledWith('default', 'default');
    });

    it('uses defaults for unspecified fields', async () => {
      const svc = new ProviderService();
      await svc.resolve({ provider: 'groq' });
      expect(resolveProviderAndModel).toHaveBeenCalledWith('groq', 'default');
    });
  });

  describe('getDefaultProvider', () => {
    it('returns default provider', async () => {
      const svc = new ProviderService();
      const result = await svc.getDefaultProvider();
      expect(result).toBe('openai');
      expect(getDefaultProvider).toHaveBeenCalled();
    });
  });

  describe('getDefaultModel', () => {
    it('returns default model', async () => {
      const svc = new ProviderService();
      const result = await svc.getDefaultModel();
      expect(result).toBe('gpt-4o-mini');
    });
  });

  describe('setDefaultProvider', () => {
    it('delegates to settings', async () => {
      const svc = new ProviderService();
      await svc.setDefaultProvider('anthropic');
      expect(setDefaultProvider).toHaveBeenCalledWith('anthropic');
    });
  });

  describe('setDefaultModel', () => {
    it('delegates to settings', async () => {
      const svc = new ProviderService();
      await svc.setDefaultModel('gpt-4');
      expect(setDefaultModel).toHaveBeenCalledWith('gpt-4');
    });
  });

  describe('listProviders', () => {
    it('returns known providers', () => {
      const svc = new ProviderService();
      const providers = svc.listProviders();
      expect(providers.length).toBeGreaterThan(0);
      expect(providers.find((p) => p.id === 'openai')).toBeDefined();
      expect(providers.find((p) => p.id === 'anthropic')).toBeDefined();
    });

    it('all providers have id, name, isAvailable', () => {
      const svc = new ProviderService();
      for (const p of svc.listProviders()) {
        expect(p.id).toBeTruthy();
        expect(p.name).toBeTruthy();
        expect(typeof p.isAvailable).toBe('boolean');
      }
    });
  });

  describe('hasApiKey', () => {
    it('returns true when env var exists', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const svc = new ProviderService();
      expect(svc.hasApiKey('openai')).toBe(true);
      delete process.env.OPENAI_API_KEY;
    });

    it('returns false when env var missing', () => {
      delete process.env.SOME_CUSTOM_API_KEY;
      const svc = new ProviderService();
      expect(svc.hasApiKey('some-custom')).toBe(false);
    });

    it('handles hyphenated provider names', () => {
      process.env.FIREWORKS_AI_API_KEY = 'test';
      const svc = new ProviderService();
      expect(svc.hasApiKey('fireworks-ai')).toBe(true);
      delete process.env.FIREWORKS_AI_API_KEY;
    });
  });

  describe('createProviderService', () => {
    it('creates a ProviderService instance', () => {
      const svc = createProviderService();
      expect(svc).toBeInstanceOf(ProviderService);
    });
  });
});
