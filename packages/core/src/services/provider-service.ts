/**
 * IProviderService - AI Provider Management Interface
 *
 * Wraps provider resolution, model listing, and provider lifecycle.
 * Actual AI completions go through the Agent; this service handles
 * provider discovery and selection.
 *
 * Usage:
 *   const providers = registry.get(Services.Provider);
 *   const resolved = await providers.resolve({ provider: 'default', model: 'default' });
 *   const models = await providers.listModels('openai');
 */

// ============================================================================
// Types
// ============================================================================

export interface ProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly isAvailable: boolean;
}

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly contextWindow?: number;
  readonly maxOutput?: number;
}

export interface ResolvedProvider {
  readonly provider: string | null;
  readonly model: string | null;
}

// ============================================================================
// IProviderService
// ============================================================================

export interface IProviderService {
  /**
   * Resolve 'default' placeholders to actual provider/model names.
   */
  resolve(options?: {
    provider?: string;
    model?: string;
  }): Promise<ResolvedProvider>;

  /**
   * Get the default provider name.
   */
  getDefaultProvider(): Promise<string | null>;

  /**
   * Get the default model for a provider.
   */
  getDefaultModel(provider?: string): Promise<string | null>;

  /**
   * Set the default provider.
   */
  setDefaultProvider(provider: string): Promise<void>;

  /**
   * Set the default model.
   */
  setDefaultModel(model: string, provider?: string): Promise<void>;

  /**
   * List all configured/available providers.
   */
  listProviders(): ProviderInfo[];

  /**
   * List models for a specific provider.
   */
  listModels(provider: string): ModelInfo[];

  /**
   * Check if a provider has a valid API key configured.
   */
  hasApiKey(provider: string): boolean;
}
