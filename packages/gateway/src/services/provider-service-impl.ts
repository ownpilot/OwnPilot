/**
 * ProviderService Implementation
 *
 * Wraps existing settings-based provider/model resolution
 * and provider config data into a unified service interface.
 */

import type {
  IProviderService,
  ProviderInfo,
  ModelInfo,
  ResolvedProvider,
} from '@ownpilot/core';
import {
  resolveProviderAndModel,
  getDefaultProvider,
  getDefaultModel,
  setDefaultProvider,
  setDefaultModel,
} from '../routes/settings.js';

// ============================================================================
// Implementation
// ============================================================================

export class ProviderService implements IProviderService {
  async resolve(options?: {
    provider?: string;
    model?: string;
  }): Promise<ResolvedProvider> {
    return resolveProviderAndModel(
      options?.provider ?? 'default',
      options?.model ?? 'default',
    );
  }

  async getDefaultProvider(): Promise<string | null> {
    return getDefaultProvider();
  }

  async getDefaultModel(provider?: string): Promise<string | null> {
    return getDefaultModel(provider);
  }

  async setDefaultProvider(provider: string): Promise<void> {
    return setDefaultProvider(provider);
  }

  async setDefaultModel(model: string): Promise<void> {
    return setDefaultModel(model);
  }

  listProviders(): ProviderInfo[] {
    // Dynamic import to avoid circular dependency at module level
    // Provider configs are loaded from data/providers/*.json
    try {
      // Return a basic list of known popular providers
      return Array.from(ProviderService.KNOWN_PROVIDERS).map(id => ({
        id,
        name: id,
        isAvailable: true, // Full availability check would need async API key check
      }));
    } catch {
      return [];
    }
  }

  /** Known provider identifiers (must match provider JSON config filenames). */
  private static readonly KNOWN_PROVIDERS = new Set([
    'openai', 'anthropic', 'google', 'azure', 'groq',
    'deepseek', 'mistral', 'cohere', 'ollama-cloud',
    'fireworks-ai', 'togetherai', 'openrouter', 'xai',
  ]);

  /** Validate provider name to prevent path traversal / env probing. */
  private static isValidProvider(provider: string): boolean {
    return ProviderService.KNOWN_PROVIDERS.has(provider);
  }

  listModels(provider: string): ModelInfo[] {
    // Validate provider name against known list to prevent path traversal via require()
    if (!ProviderService.isValidProvider(provider)) return [];

    // Models are loaded from provider JSON configs at runtime
    // This is a sync convenience method; use provider.getModels() for full async list
    try {
      const { loadProviderConfig } = require('@ownpilot/core');
      const config = loadProviderConfig(provider);
      if (!config?.models) return [];
      return config.models.map((m: { id: string; name?: string; contextWindow?: number; maxOutput?: number }) => ({
        id: m.id,
        name: m.name ?? m.id,
        provider,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
      }));
    } catch {
      return [];
    }
  }

  hasApiKey(provider: string): boolean {
    // Validate provider name to prevent env variable probing
    if (!ProviderService.isValidProvider(provider)) return false;

    // Check environment variable as a quick sync check
    const envKey = process.env[`${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`];
    return !!envKey;
  }
}

/**
 * Create a new ProviderService instance.
 */
export function createProviderService(): IProviderService {
  return new ProviderService();
}
