/**
 * AI Provider - Barrel exports + factory
 *
 * Re-exports all provider types and implementations.
 * Consumers should import from this file (unchanged API surface).
 */

export type { IProvider } from './provider-types.js';
export { BaseProvider } from './base-provider.js';
export { OpenAIProvider } from './providers/openai-provider.js';
export { AnthropicProvider } from './providers/anthropic-provider.js';

import type { ProviderConfig } from './types.js';
import type { IProvider } from './provider-types.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { GoogleProvider } from './providers/google.js';

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
        return googleProvider as unknown as IProvider;
      }
      // Fallback to OpenAI-compatible if Google provider can't be created
      return new OpenAIProvider(config);
    }
    default:
      return new OpenAIProvider(config);
  }
}
