/**
 * Provider Configuration Types
 * All provider configs are loaded from JSON files for easy maintenance
 */

/**
 * Model capability types
 */
export type ModelCapability =
  | 'chat'
  | 'code'
  | 'vision'
  | 'function_calling'
  | 'json_mode'
  | 'streaming'
  | 'embeddings'
  | 'image_generation'
  | 'audio'
  | 'reasoning'; // For o1-style models

/**
 * Model configuration
 */
export interface ModelConfig {
  /** Model ID used in API calls */
  id: string;
  /** Human-readable name */
  name: string;
  /** Context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxOutput: number;
  /** Input price per 1M tokens (USD) */
  inputPrice: number;
  /** Output price per 1M tokens (USD) */
  outputPrice: number;
  /** Model capabilities */
  capabilities: ModelCapability[];
  /** Is this the default model for this provider */
  default?: boolean;
  /** Model aliases (e.g., "gpt-4" -> "gpt-4-turbo") */
  aliases?: string[];
  /** Deprecation notice */
  deprecated?: string;
  /** Release date (for sorting/filtering) */
  releaseDate?: string;
}

/**
 * Provider type
 */
export type ProviderType =
  | 'openai'           // Native OpenAI
  | 'anthropic'        // Native Anthropic
  | 'google'           // Google AI (Gemini)
  | 'openai-compatible'; // OpenAI-compatible API

/**
 * Provider features
 */
export interface ProviderFeatures {
  /** Supports streaming responses */
  streaming: boolean;
  /** Supports tool/function calling */
  toolUse: boolean;
  /** Supports vision/image input */
  vision: boolean;
  /** Supports JSON mode */
  jsonMode: boolean;
  /** Supports system messages */
  systemMessage: boolean;
  /** Supports message caching (Anthropic) */
  caching?: boolean;
  /** Supports batch API */
  batch?: boolean;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** Unique provider ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider type (determines which client to use) */
  type: ProviderType;
  /** API base URL */
  baseUrl: string;
  /** Environment variable name for API key */
  apiKeyEnv: string;
  /** Available models */
  models: ModelConfig[];
  /** Provider features */
  features: ProviderFeatures;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
  /** Default timeout in ms */
  timeout?: number;
  /** API version (for versioned APIs) */
  apiVersion?: string;
  /** Documentation URL */
  docsUrl?: string;
  /** Provider status page URL */
  statusUrl?: string;
  /** Notes about the provider */
  notes?: string;
}

/**
 * Runtime provider instance config (with resolved API key)
 */
export interface ResolvedProviderConfig extends Omit<ProviderConfig, 'apiKeyEnv'> {
  apiKey: string;
}

/**
 * Provider selection criteria for auto-routing
 */
export interface ProviderSelectionCriteria {
  /** Required capabilities */
  capabilities?: ModelCapability[];
  /** Maximum input price per 1M tokens */
  maxInputPrice?: number;
  /** Maximum output price per 1M tokens */
  maxOutputPrice?: number;
  /** Minimum context window */
  minContextWindow?: number;
  /** Preferred providers (in order) */
  preferredProviders?: string[];
  /** Excluded providers */
  excludedProviders?: string[];
  /** Task type hint */
  taskType?: 'chat' | 'code' | 'analysis' | 'creative' | 'reasoning';
}
