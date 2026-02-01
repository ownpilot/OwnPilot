/**
 * Model & Provider Types
 *
 * Shared types for provider/model management across pages.
 */

/** Model info as returned by /api/v1/models */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  contextWindow?: number;
  inputPrice?: number;
  outputPrice?: number;
  capabilities?: string[];
  recommended?: boolean;
}

/** Full provider info as returned by /api/v1/providers */
export interface ProviderInfo {
  id: string;
  name: string;
  type: string;
  baseUrl?: string;
  apiKeyEnv: string;
  docsUrl?: string;
  isConfigured: boolean;
  isEnabled: boolean;
  hasOverride: boolean;
  color?: string;
  modelCount: number;
  features: {
    streaming: boolean;
    toolUse: boolean;
    vision: boolean;
    jsonMode: boolean;
    systemMessage: boolean;
  };
}

/** Provider config as used in API keys page */
export interface ProviderConfig {
  id: string;
  name: string;
  apiKeyEnv: string;
  baseUrl?: string;
  docsUrl?: string;
  models?: { id: string; name: string }[];
  apiKeyPlaceholder?: string;
  color?: string;
}

/** User override for provider settings */
export interface UserOverride {
  baseUrl?: string;
  providerType?: string;
  isEnabled: boolean;
  apiKeyEnv?: string;
  notes?: string;
}

/** Local provider (Ollama, LM Studio, etc.) */
export interface LocalProviderInfo {
  id: string;
  name: string;
  type: 'local';
}
