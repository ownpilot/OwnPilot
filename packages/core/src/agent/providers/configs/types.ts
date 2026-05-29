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
  | 'openai' // Native OpenAI
  | 'anthropic' // Native Anthropic
  | 'google' // Google AI (Gemini)
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
 * How a provider authenticates requests. Most providers ship with
 * `'api_key'`; subscription / sign-in flows like Codex, ChatGPT, or xAI
 * Grok use `'session_token'` (long-lived bearer) or one of the OAuth
 * variants. All four reduce to an `Authorization: Bearer <value>` header
 * at request time — see {@link getAuthHeader}.
 */
export type AuthMethod =
  | 'api_key' // Static API key (default)
  | 'session_token' // Long-lived bearer pasted from a logged-in session
  | 'oauth2_device_code' // OAuth 2.0 device-code flow (used by Codex CLI)
  | 'oauth2_pkce'; // OAuth 2.0 PKCE (browser sign-in)

/**
 * Declares which auth methods a provider supports + which one is the
 * default for new credentials. Existing JSON configs that omit `auth`
 * are treated as `{ default: 'api_key', supported: ['api_key'] }` so
 * adding this field is backward-compatible.
 */
export interface ProviderAuthSupport {
  /** Auth method used when the user hasn't picked one explicitly. */
  default: AuthMethod;
  /** Every method this provider actually accepts. */
  supported: AuthMethod[];
  /** OAuth-specific config; only meaningful when one of the oauth2_* methods is supported. */
  oauth?: ProviderOAuthConfig;
}

export interface ProviderOAuthConfig {
  /** Device-code endpoint (RFC 8628) — required when 'oauth2_device_code' is supported. */
  deviceCodeUrl?: string;
  /** Authorization endpoint — required when 'oauth2_pkce' is supported. */
  authorizationUrl?: string;
  /** Token endpoint — required for any oauth2_* method. */
  tokenUrl?: string;
  /** Client ID issued by the provider. */
  clientId?: string;
  /** Default scopes requested. */
  scopes?: string[];
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
  /**
   * Supported auth methods. Optional — providers omitting this are
   * treated as api-key-only for backward compatibility.
   */
  auth?: ProviderAuthSupport;
  /** Available models */
  models: ModelConfig[];
  /** Provider features */
  features: ProviderFeatures;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
  /** Custom endpoint path (defaults to /chat/completions for openai-compatible) */
  endpoint?: string;
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
 * Resolved auth state for a single provider request. Carries enough
 * information for the provider implementation to build the right header
 * and for the resolver to decide when to refresh.
 *
 * The discriminant is {@link ResolvedAuth.method}.
 */
export type ResolvedAuth =
  | { method: 'api_key'; value: string }
  | { method: 'session_token'; value: string; expiresAt?: number }
  | {
      method: 'oauth2_device_code' | 'oauth2_pkce';
      value: string; // current access token
      refreshToken?: string;
      expiresAt?: number; // epoch ms
      scopes?: string[];
    };

/**
 * Build the HTTP Authorization header from a {@link ResolvedAuth}.
 * Every supported method currently reduces to `Bearer <value>`; keeping
 * this in one helper means provider implementations don't have to grow
 * a switch as new methods land.
 */
export function getAuthHeader(auth: ResolvedAuth): string {
  return `Bearer ${auth.value}`;
}

/**
 * True when the resolved auth's `expiresAt` is in the past (or within a
 * 30s skew). Used by the resolver to decide whether to refresh before
 * handing the auth to a provider.
 */
export function isAuthExpired(auth: ResolvedAuth, nowMs: number = Date.now()): boolean {
  if (auth.method === 'api_key') return false;
  if (auth.expiresAt === undefined) return false;
  return auth.expiresAt <= nowMs + 30_000;
}

/**
 * Runtime provider instance config (with resolved credentials).
 *
 * `apiKey` is retained as the canonical bearer value for backward
 * compatibility — every existing provider implementation reads it.
 * New code should prefer {@link ResolvedProviderConfig.resolvedAuth}
 * so it can surface session_token / oauth tokens distinctly (refresh,
 * expiry, UX labelling). The resolver guarantees
 * `apiKey === resolvedAuth.value` regardless of method.
 */
export interface ResolvedProviderConfig extends Omit<ProviderConfig, 'apiKeyEnv'> {
  apiKey: string;
  /**
   * Full resolved auth. Defaults to `{ method: 'api_key', value: apiKey }`
   * for callers that only set the legacy `apiKey` field.
   */
  resolvedAuth?: ResolvedAuth;
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
