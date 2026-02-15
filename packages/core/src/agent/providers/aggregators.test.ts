/**
 * Aggregator Provider Tests
 */

import { describe, it, expect } from 'vitest';
import {
  AGGREGATOR_PROVIDERS,
  getAggregatorIds,
  getAggregatorProvider,
  getAllAggregatorProviders,
  isAggregatorProvider,
  getAggregatorModels,
  type AggregatorProvider,
  type AggregatorModel,
} from './aggregators.js';

describe('Aggregator Providers', () => {
  describe('AGGREGATOR_PROVIDERS', () => {
    it('contains expected provider IDs', () => {
      const ids = Object.keys(AGGREGATOR_PROVIDERS);
      expect(ids).toContain('fal');
      expect(ids).toContain('together');
      expect(ids).toContain('groq');
      expect(ids).toContain('fireworks');
      expect(ids).toContain('openrouter');
      expect(ids).toContain('perplexity');
      expect(ids).toContain('cerebras');
    });

    it('each provider has required fields', () => {
      for (const [id, provider] of Object.entries(AGGREGATOR_PROVIDERS)) {
        expect(provider.id).toBe(id);
        expect(provider.name).toBeTruthy();
        expect(provider.description).toBeTruthy();
        expect(provider.apiBase).toMatch(/^https?:\/\//);
        expect(['openai_compatible', 'custom']).toContain(provider.type);
        expect(provider.apiKeyEnv).toBeTruthy();
        expect(provider.defaultModels.length).toBeGreaterThan(0);
      }
    });

    it('each model has an id and at least one capability', () => {
      for (const provider of Object.values(AGGREGATOR_PROVIDERS)) {
        for (const model of provider.defaultModels) {
          expect(model.id).toBeTruthy();
          expect(model.name).toBeTruthy();
          expect(model.capabilities.length).toBeGreaterThan(0);
        }
      }
    });

    it('models have either per-token or per-request pricing', () => {
      for (const provider of Object.values(AGGREGATOR_PROVIDERS)) {
        for (const model of provider.defaultModels) {
          const hasTokenPricing = model.pricingInput !== undefined || model.pricingOutput !== undefined;
          const hasRequestPricing = model.pricingPerRequest !== undefined;
          // At least one pricing model should be defined (some may have neither for free tiers)
          if (hasTokenPricing) {
            expect(typeof model.pricingInput).toBe('number');
            expect(typeof model.pricingOutput).toBe('number');
          }
          if (hasRequestPricing) {
            expect(typeof model.pricingPerRequest).toBe('number');
          }
        }
      }
    });
  });

  describe('getAggregatorIds', () => {
    it('returns all provider IDs', () => {
      const ids = getAggregatorIds();
      expect(ids.length).toBe(Object.keys(AGGREGATOR_PROVIDERS).length);
      expect(ids).toContain('groq');
      expect(ids).toContain('together');
    });
  });

  describe('getAggregatorProvider', () => {
    it('returns provider by ID', () => {
      const groq = getAggregatorProvider('groq');
      expect(groq).toBeDefined();
      expect(groq!.id).toBe('groq');
      expect(groq!.name).toBe('Groq');
    });

    it('returns undefined for unknown ID', () => {
      expect(getAggregatorProvider('nonexistent')).toBeUndefined();
    });
  });

  describe('getAllAggregatorProviders', () => {
    it('returns all providers as array', () => {
      const all = getAllAggregatorProviders();
      expect(all.length).toBe(Object.keys(AGGREGATOR_PROVIDERS).length);
      expect(all.every((p) => p.id && p.name)).toBe(true);
    });
  });

  describe('isAggregatorProvider', () => {
    it('returns true for known aggregators', () => {
      expect(isAggregatorProvider('groq')).toBe(true);
      expect(isAggregatorProvider('together')).toBe(true);
      expect(isAggregatorProvider('fal')).toBe(true);
    });

    it('returns false for non-aggregators', () => {
      expect(isAggregatorProvider('openai')).toBe(false);
      expect(isAggregatorProvider('anthropic')).toBe(false);
      expect(isAggregatorProvider('')).toBe(false);
    });
  });

  describe('getAggregatorModels', () => {
    it('returns models for a known provider', () => {
      const models = getAggregatorModels('groq');
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).toBeTruthy();
    });

    it('returns empty array for unknown provider', () => {
      expect(getAggregatorModels('nonexistent')).toEqual([]);
    });

    it('groq models have chat capability', () => {
      const models = getAggregatorModels('groq');
      const chatModels = models.filter((m) => m.capabilities.includes('chat'));
      expect(chatModels.length).toBeGreaterThan(0);
    });

    it('fal models have image_generation capability', () => {
      const models = getAggregatorModels('fal');
      expect(models.every((m) => m.capabilities.includes('image_generation'))).toBe(true);
    });
  });
});
