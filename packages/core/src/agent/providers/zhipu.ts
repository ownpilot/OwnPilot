/**
 * Zhipu AI (GLM) Provider
 *
 * Zhipu uses OpenAI-compatible API format.
 * This is a convenience wrapper around OpenAICompatibleProvider.
 *
 * Configuration loaded from ./configs/zhipu.json
 */

import type { ProviderConfig as LegacyProviderConfig } from '../types.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

/**
 * Zhipu Provider (alias for OpenAI-compatible)
 */
export type ZhipuProvider = OpenAICompatibleProvider;

/**
 * Create Zhipu provider
 */
export function createZhipuProvider(config?: LegacyProviderConfig): OpenAICompatibleProvider | null {
  if (config?.apiKey) {
    return OpenAICompatibleProvider.fromProviderIdWithKey('zhipu', config.apiKey);
  }
  return OpenAICompatibleProvider.fromProviderId('zhipu');
}
