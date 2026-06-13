/**
 * AI Provider - Barrel exports + factory
 *
 * Re-exports all provider types and implementations.
 * Consumers should import from this file (unchanged API surface).
 */

export type { IProvider } from './provider-types.js';
export type { ProviderHealthResult } from './provider-types.js';
export { BaseProvider } from './base-provider.js';

import type { ProviderConfig } from './types.js';
import type { IProvider } from './provider-types.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { GoogleProvider } from './providers/google.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.js';
import type { ResolvedProviderConfig } from './providers/configs/index.js';

/**
 * Create a provider instance based on configuration
 */
export function createProvider(config: ProviderConfig): IProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'google': {
      // Use native Google/Gemini provider for proper thoughtSignature support
      const googleProvider = GoogleProvider.withApiKey(config.apiKey ?? '');
      if (googleProvider) {
        // trust boundary: withApiKey returns IProvider | null, but the
        // GoogleProvider class declared its return type more narrowly in
        // an older signature. The non-null branch is type-safe at runtime.
        return googleProvider as unknown as IProvider;
      }
      // Fallback to OpenAI-compatible if Google provider can't be created
      return new OpenAIProvider(config);
    }
    case 'openai-compatible':
      // trust boundary: ProviderConfig is a wider type than
      // ResolvedProviderConfig (id is required on the latter). The
      // `id: config.id ?? config.provider` line above resolves the gap;
      // the cast documents that the wider type is sound in this factory.
      return new OpenAICompatibleProvider({
        ...config,
        id: config.id ?? config.provider,
      } as unknown as ResolvedProviderConfig) as unknown as IProvider;
    default:
      return new OpenAIProvider(config);
  }
}
