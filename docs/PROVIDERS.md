# OwnPilot Provider System

Comprehensive reference for the multi-provider AI architecture in OwnPilot. This document covers every provider type, the routing and fallback system, model capabilities, configuration loading, aggregator services, local inference, database overrides, and the UI management layer.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Supported AI Providers](#2-supported-ai-providers)
3. [Provider Interface and Base Classes](#3-provider-interface-and-base-classes)
4. [Provider Implementations](#4-provider-implementations)
5. [Provider Router](#5-provider-router)
6. [Fallback Provider](#6-fallback-provider)
7. [Provider Configuration System](#7-provider-configuration-system)
8. [Model Capabilities](#8-model-capabilities)
9. [Provider Presets](#9-provider-presets)
10. [Aggregator Providers](#10-aggregator-providers)
11. [Local Providers](#11-local-providers)
12. [Database Layer](#12-database-layer)
13. [Gateway API Routes](#13-gateway-api-routes)
14. [UI Management Pages](#14-ui-management-pages)
15. [Config Center Integration](#15-config-center-integration)
16. [Retry and Error Handling](#16-retry-and-error-handling)
17. [Models.dev Sync](#17-modelsdev-sync)
18. [Adding a New Provider](#18-adding-a-new-provider)

---

## 1. Architecture Overview

The provider system is organized into layers that separate concern cleanly:

```
                        +-------------------+
                        |     UI Layer      |
                        | AIModelsPage.tsx   |
                        | ProvidersTab.tsx   |
                        +--------+----------+
                                 |
                        +--------v----------+
                        |   Gateway Routes  |
                        | /api/v1/providers |
                        | /api/v1/models    |
                        | /api/v1/model-configs |
                        | /api/v1/local-providers |
                        +--------+----------+
                                 |
              +------------------+------------------+
              |                  |                   |
    +---------v------+  +-------v--------+  +-------v--------+
    | Provider Router|  | Fallback       |  | Config Loader  |
    | (Smart Select) |  | Provider       |  | (JSON + DB)    |
    +-------+--------+  +-------+--------+  +-------+--------+
            |                    |                   |
    +-------v--------------------v-------------------v--------+
    |                  Provider Implementations                |
    |  OpenAIProvider | AnthropicProvider | GoogleProvider     |
    |  OpenAICompatibleProvider | ZhipuProvider                |
    +---------------------------------------------------------+
            |                    |                   |
    +-------v--------+  +-------v--------+  +-------v--------+
    | OpenAI API     |  | Anthropic API  |  | Gemini API     |
    | (+ all compat) |  | (Claude)       |  | (Google AI)    |
    +----------------+  +----------------+  +----------------+
```

**Key packages:**

| Package | Path | Purpose |
|---------|------|---------|
| `@ownpilot/core` | `packages/core/src/agent/` | Provider types, implementations, router, configs |
| `@ownpilot/gateway` | `packages/gateway/src/routes/` | REST API routes for provider management |
| `@ownpilot/ui` | `packages/ui/src/` | React UI for provider/model management |

---

## 2. Supported AI Providers

The `AIProvider` type union defines all supported provider identifiers.

**Source:** `packages/core/src/agent/types.ts`

```typescript
export type AIProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'groq'
  | 'mistral'
  | 'zhipu'
  | 'cohere'
  | 'together'
  | 'fireworks'
  | 'perplexity'
  | 'openrouter'
  | 'xai'
  | 'local'
  | 'custom';
```

Beyond this type union, the config-driven system (`providers/configs/index.ts`) recognizes **100+ provider IDs** loaded from JSON files, including cloud platforms (Azure, AWS Bedrock, Google Vertex), Chinese providers (Alibaba, Zhipu, Moonshot, MiniMax, Xiaomi), inference platforms (DeepInfra, Cerebras, Novita), and many more.

### Provider Categories

| Category | Providers | Notes |
|----------|-----------|-------|
| **Tier 1 (Native)** | OpenAI, Anthropic, Google | Dedicated provider classes with API-specific handling |
| **Tier 2 (OpenAI-Compatible)** | DeepSeek, Groq, Mistral, xAI, Together, Fireworks, Perplexity, Cohere | Use `OpenAICompatibleProvider` with per-provider JSON configs |
| **Aggregators** | OpenRouter, fal.ai, DeepInfra, Cerebras | Route to multiple upstream providers through a single API |
| **Chinese Providers** | Zhipu, Alibaba/DashScope, Moonshot, MiniMax, Xiaomi | OpenAI-compatible; some have China-specific endpoints |
| **Cloud Platforms** | Azure OpenAI, Amazon Bedrock, Google Vertex, Cloudflare Workers AI | Require platform-specific configuration |
| **Local** | Ollama, LM Studio, LocalAI, vLLM | Run on localhost; auto-discovery of models |

---

## 3. Provider Interface and Base Classes

**Source:** `packages/core/src/agent/provider.ts`

### IProvider Interface

Every provider must implement this interface:

```typescript
export interface IProvider {
  /** Provider type identifier */
  readonly type: AIProvider;

  /** Check if the provider has valid credentials and is operational */
  isReady(): boolean;

  /** Send a completion request and receive a full response */
  complete(
    request: CompletionRequest
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError | ValidationError>>;

  /** Stream a completion request, yielding chunks as they arrive */
  stream(
    request: CompletionRequest
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown>;

  /** Approximate token count for messages (rough: ~4 chars per token) */
  countTokens(messages: readonly Message[]): number;

  /** Retrieve available model IDs from this provider */
  getModels(): Promise<Result<string[], InternalError>>;
}
```

All return types use the `Result<T, E>` pattern (from `packages/core/src/types/result.ts`), which forces callers to handle success and failure explicitly rather than relying on exceptions.

### BaseProvider Abstract Class

`BaseProvider` provides shared logic for all providers:

```typescript
export abstract class BaseProvider implements IProvider {
  abstract readonly type: AIProvider;
  protected readonly config: ProviderConfig;
  protected abortController: AbortController | null = null;

  constructor(config: ProviderConfig) { ... }

  /** Approximate token count: ~4 chars/token */
  countTokens(messages: readonly Message[]): number;

  /** Abort the current in-flight request */
  cancel(): void;

  /** Build fetch options with timeout, auth headers, abort signal */
  protected createFetchOptions(body: unknown, timeoutMs?: number): RequestInit;

  /** Parse tool_calls from raw API response data */
  protected parseToolCalls(toolCalls: unknown): ToolCall[];

  /** Convert Message[] to the OpenAI message format for API requests */
  protected buildMessages(messages: readonly Message[]): Array<...>;

  /** Convert ToolDefinition[] to the OpenAI tools format */
  protected buildTools(request: CompletionRequest): Array<...> | undefined;
}
```

**Key behaviors in BaseProvider:**

- **Timeout**: Defaults to 300,000 ms (5 minutes). Configurable via `ProviderConfig.timeout`.
- **Auth Headers**: Automatically sets `Authorization: Bearer <apiKey>` and optionally `OpenAI-Organization`.
- **Token Counting**: Rough approximation at 4 characters per token. Not a tokenizer -- sufficient for context management heuristics.
- **Cancellation**: `cancel()` aborts the `AbortController`, immediately terminating any in-flight `fetch`.

### CompletionRequest

```typescript
export interface CompletionRequest {
  readonly messages: readonly Message[];
  readonly model: ModelConfig;
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  readonly stream?: boolean;
  readonly user?: string;
}
```

### CompletionResponse

```typescript
export interface CompletionResponse {
  readonly id: string;
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  readonly usage?: TokenUsage;
  readonly model: string;
  readonly createdAt: Date;
}
```

### StreamChunk

```typescript
export interface StreamChunk {
  readonly id: string;
  readonly content?: string;
  readonly toolCalls?: readonly Partial<ToolCall>[];
  readonly done: boolean;
  readonly finishReason?: CompletionResponse['finishReason'];
  readonly usage?: TokenUsage;
}
```

---

## 4. Provider Implementations

### 4.1 OpenAIProvider

**Source:** `packages/core/src/agent/provider.ts`
**Type:** `'openai'`
**Base URL:** `https://api.openai.com/v1`

Handles native OpenAI API calls (GPT-4o, GPT-5, o3, o4-mini, etc.).

**Key characteristics:**
- Extends `BaseProvider`.
- Uses the `withRetry` wrapper with exponential backoff (max 3 retries, 1s initial delay, 10s max, 2x multiplier, jitter enabled).
- Streaming uses Server-Sent Events (SSE) with `data: [DONE]` termination.
- Requests `stream_options: { include_usage: true }` for token counts in streaming mode.
- Maps finish reasons: `stop`, `length`, `tool_calls`, `content_filter`.
- `getModels()` fetches from `/models` and filters to IDs containing `gpt`.
- Full debug logging via `logRequest`/`logResponse` with payload size breakdown.

**Usage:**

```typescript
import { OpenAIProvider } from '@ownpilot/core';

const provider = new OpenAIProvider({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
});

const result = await provider.complete({
  messages: [{ role: 'user', content: 'Hello' }],
  model: { model: 'gpt-4o', maxTokens: 1024, temperature: 0.7 },
});
```

### 4.2 AnthropicProvider

**Source:** `packages/core/src/agent/provider.ts`
**Type:** `'anthropic'`
**Base URL:** `https://api.anthropic.com/v1`

Handles Anthropic's Messages API (Claude Opus 4.5, Claude Sonnet 4.5, Claude 3.5 Sonnet, etc.).

**Key characteristics:**
- Uses `x-api-key` header instead of Bearer token.
- Includes `anthropic-version: 2023-06-01` header.
- Extracts system messages from the conversation and passes them via the top-level `system` field.
- Maps tool results as `tool_result` content blocks under `user` role.
- Handles Anthropic-specific content block types: `text` and `tool_use`.
- Maps stop reasons: `end_turn` -> `stop`, `max_tokens` -> `length`, `tool_use` -> `tool_calls`.
- `getModels()` returns a hardcoded list (Anthropic has no public models endpoint).

**Anthropic-specific message format:**

```typescript
// Tool results are sent as user messages with tool_result content blocks
{
  role: 'user',
  content: [{
    type: 'tool_result',
    tool_use_id: 'call_123',
    content: '{"result": "data"}',
    is_error: false,
  }]
}
```

### 4.3 GoogleProvider

**Source:** `packages/core/src/agent/providers/google.ts`
**Type:** `'google'`
**Base URL:** `https://generativelanguage.googleapis.com/v1beta`

Native implementation for Google's Gemini API, distinct from the OpenAI-compatible approach.

**Key characteristics:**
- API key passed as URL query parameter (`?key=...`), not in headers.
- Uses the `generateContent` / `streamGenerateContent` endpoints.
- System messages become `systemInstruction` in the request body.
- Supports **thinking models** (Gemini 2.0+ with `thought: true` parts).
- Handles **thoughtSignature** for Gemini 3+ thinking models -- these signatures must be echoed back in `functionResponse` parts to maintain conversation coherence.
- Thinking content is wrapped in `<thinking>...</thinking>` tags in the response.
- Uses role mapping: `assistant` -> `model`, all others -> `user`.
- Image support via `inlineData` parts with `mimeType` and base64 `data`.
- Retry logic is internal (3 retries with exponential backoff, 30s per-attempt timeout).
- Retryable status codes: 429, 500, 502, 503, 504.
- Retryable error names: `AbortError`, `ETIMEDOUT`, `ECONNRESET`, `ENOTFOUND`, `EAI_AGAIN`.

**Factory methods:**

```typescript
// Create from environment variable (GOOGLE_GENERATIVE_AI_API_KEY)
const provider = GoogleProvider.fromEnv();

// Create with explicit API key
const provider = GoogleProvider.withApiKey('AIza...');
```

**Gemini tool call format:**

```typescript
// Gemini returns functionCall parts, not tool_calls
{
  parts: [{
    functionCall: {
      name: 'search_web',
      args: { query: 'latest news' }
    },
    thoughtSignature: 'base64...' // Only for thinking models
  }]
}
```

### 4.4 OpenAICompatibleProvider

**Source:** `packages/core/src/agent/providers/openai-compatible.ts`
**Type:** Varies per provider (set from config JSON)

A generic provider implementation that works with any API following the OpenAI chat completions format. This is the workhorse class powering most providers.

**Supported providers via factory functions:**

| Function | Provider | API Base |
|----------|----------|----------|
| `createDeepSeekProvider()` | DeepSeek | `https://api.deepseek.com/v1` |
| `createGroqProvider()` | Groq | `https://api.groq.com/openai/v1` |
| `createTogetherProvider()` | Together AI | `https://api.together.xyz/v1` |
| `createFireworksProvider()` | Fireworks AI | `https://api.fireworks.ai/inference/v1` |
| `createMistralProvider()` | Mistral AI | `https://api.mistral.ai/v1` |
| `createXAIProvider()` | xAI (Grok) | `https://api.x.ai/v1` |
| `createPerplexityProvider()` | Perplexity | `https://api.perplexity.ai` |

**Key characteristics:**
- All configuration (base URL, API key env var, models, features) loaded from JSON files.
- Feature-gated: tools are only included in the request body if `config.features.toolUse` is true; vision content is only included if `config.features.vision` is true; JSON mode only if `config.features.jsonMode` is true.
- Handles **reasoning content** from DeepSeek R1 and similar models (`reasoning_content` field in response/delta). Reasoning is prefixed with `<thinking>...</thinking>` tags.
- Default timeout: 120,000 ms (2 minutes).
- Custom headers from provider config are merged into each request.
- Two methods for model listing: `getModels()` (from JSON config, no API call) and `fetchModelsFromAPI()` (live query to `/models` endpoint with fallback to config).

**Creation patterns:**

```typescript
// From provider ID (loads JSON config + env var)
const provider = OpenAICompatibleProvider.fromProviderId('deepseek');

// With explicit API key
const provider = OpenAICompatibleProvider.fromProviderIdWithKey('groq', 'gsk_...');

// Generic factory
const provider = createOpenAICompatibleProvider('mistral');
```

### 4.5 ZhipuProvider

**Source:** `packages/core/src/agent/providers/zhipu.ts`
**Type:** Type alias for `OpenAICompatibleProvider`

Zhipu AI (GLM models) uses OpenAI-compatible API format. This module is a thin convenience wrapper:

```typescript
export type ZhipuProvider = OpenAICompatibleProvider;

export function createZhipuProvider(config?: LegacyProviderConfig): OpenAICompatibleProvider | null {
  if (config?.apiKey) {
    return OpenAICompatibleProvider.fromProviderIdWithKey('zhipu', config.apiKey);
  }
  return OpenAICompatibleProvider.fromProviderId('zhipu');
}
```

### 4.6 Provider Factory

**Source:** `packages/core/src/agent/provider.ts`

The `createProvider()` function instantiates the correct provider class based on the configuration:

```typescript
export function createProvider(config: ProviderConfig): IProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'google': {
      const googleProvider = GoogleProvider.withApiKey(config.apiKey ?? '');
      if (googleProvider) return googleProvider as unknown as IProvider;
      // Fallback to OpenAI-compatible if GoogleProvider creation fails
      return new OpenAIProvider(config);
    }
    default:
      // All other providers use OpenAI-compatible format
      return new OpenAIProvider(config);
  }
}
```

---

## 5. Provider Router

**Source:** `packages/core/src/agent/providers/router.ts`

The `ProviderRouter` automatically selects the best provider and model for a given request based on configurable strategies.

### Routing Strategies

```typescript
export type RoutingStrategy =
  | 'cheapest'   // Minimize cost per token
  | 'fastest'    // Minimize latency (prefers Groq, Fireworks, Together, DeepSeek)
  | 'smartest'   // Best quality/reasoning (prefers reasoning models, Anthropic, OpenAI)
  | 'balanced'   // Balance cost, quality, and speed (default)
  | 'fallback';  // Try providers in order until one works
```

### RouterConfig

```typescript
export interface RouterConfig {
  /** Default routing strategy (default: 'balanced') */
  defaultStrategy?: RoutingStrategy;
  /** Fallback provider order (default: ['anthropic', 'openai', 'google', 'deepseek', 'groq']) */
  fallbackOrder?: string[];
  /** Maximum retries on failure (default: 3) */
  maxRetries?: number;
  /** Required capabilities for all requests */
  requiredCapabilities?: ModelCapability[];
  /** Excluded providers (will never be selected) */
  excludedProviders?: string[];
}
```

### RoutingResult

```typescript
export interface RoutingResult {
  providerId: string;                                   // e.g. 'anthropic'
  modelId: string;                                      // e.g. 'claude-3-5-sonnet-20241022'
  provider: OpenAICompatibleProvider | GoogleProvider;   // Instantiated provider
  modelConfig: ModelConfig;                             // Full model metadata
  estimatedCost: {
    inputPer1M: number;   // USD per 1M input tokens
    outputPer1M: number;  // USD per 1M output tokens
  };
}
```

### ProviderRouter Class

```typescript
class ProviderRouter {
  constructor(config?: RouterConfig);

  /** Get all providers with valid API keys, excluding blocked providers */
  getAvailableProviders(): ResolvedProviderConfig[];

  /** Select a provider and model based on criteria and strategy */
  selectProvider(
    criteria?: ProviderSelectionCriteria,
    strategy?: RoutingStrategy
  ): Result<RoutingResult, ValidationError>;

  /** Complete a request with automatic provider selection */
  complete(
    request: CompletionRequest,
    criteria?: ProviderSelectionCriteria,
    strategy?: RoutingStrategy
  ): Promise<Result<CompletionResponse & { routingInfo: RoutingResult }, ...>>;

  /** Stream a request with automatic provider selection */
  stream(
    request: CompletionRequest,
    criteria?: ProviderSelectionCriteria,
    strategy?: RoutingStrategy
  ): AsyncGenerator<Result<StreamChunk & { routingInfo?: RoutingResult }, ...>>;

  /** Try multiple providers in sequence until one succeeds */
  completeWithFallback(
    request: CompletionRequest,
    criteria?: ProviderSelectionCriteria
  ): Promise<Result<CompletionResponse & { routingInfo: RoutingResult; attempts: string[] }, ...>>;

  /** Estimate cost for a request without sending it */
  estimateCost(
    inputTokens: number,
    outputTokens: number,
    criteria?: ProviderSelectionCriteria,
    strategy?: RoutingStrategy
  ): Result<{ providerId: string; modelId: string; estimatedCost: number }, ValidationError>;

  /** Clear cached provider instances */
  clearCache(): void;
}
```

### Strategy Selection Logic

| Strategy | Selection Method | Description |
|----------|-----------------|-------------|
| `cheapest` | `getCheapestModel()` | Sorts all matching models by `inputPrice + outputPrice` ascending |
| `fastest` | `getFastestModel()` | Prefers providers `groq > fireworks > together > deepseek`; within that, favors smaller context windows and lower prices |
| `smartest` | `getSmartestModel()` | First tries models with `reasoning` capability preferring `anthropic > openai > deepseek`; falls back to `anthropic > openai > google` |
| `balanced` | `selectBestModel()` | Scores models on capability match, price efficiency, default status, preferred provider order, and task type bonus |
| `fallback` | Same as `balanced` | Falls through to `selectBestModel()` |

### Quick Helpers

```typescript
// One-liner: complete with the best available provider
const result = await routedComplete(request, { capabilities: ['chat', 'function_calling'] });

// Get cheapest provider for chat
const cheapest = getCheapestProvider(['chat']);

// Get fastest provider for code
const fastest = getFastestProvider(['chat', 'code']);

// Get smartest for reasoning tasks
const smartest = getSmartestProvider(['chat', 'reasoning']);
```

### Provider Selection Criteria

```typescript
export interface ProviderSelectionCriteria {
  capabilities?: ModelCapability[];    // Required capabilities
  maxInputPrice?: number;              // Max $/1M input tokens
  maxOutputPrice?: number;             // Max $/1M output tokens
  minContextWindow?: number;           // Minimum context window tokens
  preferredProviders?: string[];       // Preferred providers (ordered)
  excludedProviders?: string[];        // Blacklisted providers
  taskType?: 'chat' | 'code' | 'analysis' | 'creative' | 'reasoning';
}
```

### Scoring Algorithm (balanced strategy)

The `findModels()` function in `configs/loader.ts` scores each candidate model:

1. **Capability match**: +10 points per required capability present.
2. **Preferred provider bonus**: +20 points for first preferred, +18 for second, etc.
3. **Task type bonus**: +15 for `code` capability on code tasks, +20 for `reasoning` on reasoning tasks, +10 for `vision` on analysis tasks.
4. **Default model bonus**: +5 points.
5. **Price efficiency**: +20 minus average price (lower price = higher score, capped at 0).

Results are sorted by score descending. The highest-scoring candidate is selected.

---

## 6. Fallback Provider

**Source:** `packages/core/src/agent/providers/fallback.ts`

The `FallbackProvider` wraps a primary provider with ordered fallback alternatives. If the primary fails with a retryable error, it automatically tries the next provider in the chain.

### FallbackProviderConfig

```typescript
export interface FallbackProviderConfig {
  /** Primary provider configuration */
  primary: ProviderConfig;
  /** Fallback providers in priority order */
  fallbacks: ProviderConfig[];
  /** Enable/disable fallback behavior (default: true) */
  enableFallback?: boolean;
  /** Callback when a fallback is triggered */
  onFallback?: (
    failedProvider: AIProvider,
    error: Error,
    nextProvider: AIProvider
  ) => void;
}
```

### Fallback Decision Logic

The `shouldFallback()` method determines whether to try the next provider:

| Error Type | Fallback? | Reasoning |
|------------|-----------|-----------|
| `TimeoutError` | Yes | Transient infrastructure issue |
| Rate limit (429) | Yes | Provider-specific limit |
| Server errors (500-504) | Yes | Provider outage |
| Network errors (ECONNRESET, ECONNREFUSED, etc.) | Yes | Connectivity issue |
| "Invalid API key" / "Not configured" | **No** | Would fail on all providers |
| `ValidationError` | **No** | Client-side issue |
| Unknown `InternalError` | Yes | Default to trying fallback |

### Usage

```typescript
import { createProviderWithFallbacks } from '@ownpilot/core';

// Primary: Anthropic, Fallbacks: OpenAI then DeepSeek
const provider = createProviderWithFallbacks(
  { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  {
    fallbacks: [
      { provider: 'openai', apiKey: process.env.OPENAI_API_KEY },
      { provider: 'deepseek', apiKey: process.env.DEEPSEEK_API_KEY },
    ],
    onFallback: (failed, error, next) => {
      console.log(`Provider ${failed} failed, switching to ${next}`);
    },
  }
);

// This will try Anthropic first, then OpenAI, then DeepSeek
const result = await provider.complete(request);
```

### Streaming Fallback

Streaming fallback has a special constraint: if the primary provider has already yielded chunks before failing, those chunks have been sent to the client. The fallback provider starts fresh. The `FallbackProvider` handles this by:

1. Starting the generator for the current provider.
2. If an error occurs before any data is yielded, moving to the next provider.
3. If data was yielded and the stream ends normally, returning success.
4. If data was yielded but an error occurs mid-stream, the error is yielded to the caller (no fallback for partial streams).

---

## 7. Provider Configuration System

**Source:** `data/providers/` (JSON configs synced from models.dev), `packages/core/src/agent/providers/configs/` (loader and sync logic)

### 7.1 Type Definitions

**Source:** `packages/core/src/agent/providers/configs/types.ts`

```typescript
export type ProviderType =
  | 'openai'            // Native OpenAI client
  | 'anthropic'         // Native Anthropic client
  | 'google'            // Native Google Gemini client
  | 'openai-compatible'; // Generic OpenAI-compatible client

export interface ProviderFeatures {
  streaming: boolean;      // Supports streaming responses
  toolUse: boolean;        // Supports tool/function calling
  vision: boolean;         // Supports image input
  jsonMode: boolean;       // Supports JSON response format
  systemMessage: boolean;  // Supports system messages
  caching?: boolean;       // Supports prompt caching (Anthropic)
  batch?: boolean;         // Supports batch API
}

export interface ProviderConfig {
  id: string;              // Unique provider ID (e.g., 'openai')
  name: string;            // Display name (e.g., 'OpenAI')
  type: ProviderType;      // Which client implementation to use
  baseUrl: string;         // API endpoint
  apiKeyEnv: string;       // Environment variable for API key
  models: ModelConfig[];   // Available models
  features: ProviderFeatures;
  headers?: Record<string, string>;  // Custom request headers
  timeout?: number;        // Default timeout in ms
  apiVersion?: string;     // API version string
  docsUrl?: string;        // Link to provider docs
  statusUrl?: string;      // Link to provider status page
  notes?: string;          // Freeform notes
}

export interface ModelConfig {
  id: string;              // Model ID for API calls
  name: string;            // Human-readable name
  contextWindow: number;   // Context window in tokens
  maxOutput: number;       // Max output tokens
  inputPrice: number;      // USD per 1M input tokens
  outputPrice: number;     // USD per 1M output tokens
  capabilities: ModelCapability[];
  default?: boolean;       // Default model for this provider
  aliases?: string[];      // Alternate model IDs
  deprecated?: string;     // Deprecation notice
  releaseDate?: string;    // ISO date string
}

export interface ResolvedProviderConfig extends Omit<ProviderConfig, 'apiKeyEnv'> {
  apiKey: string;          // Actual API key value (resolved from env)
}
```

### 7.2 JSON Configuration Files

Each provider has a JSON file at `data/providers/<provider-id>.json`. These files follow the `ProviderConfig` schema and are loaded at runtime. The configs were moved from `packages/core/src/agent/providers/configs/` to the top-level `data/providers/` directory for easier management and sync.

**Example: `openai.json` (abbreviated)**

```json
{
  "id": "openai",
  "name": "OpenAI",
  "type": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY",
  "docsUrl": "https://platform.openai.com/docs",
  "features": {
    "streaming": true,
    "toolUse": true,
    "vision": true,
    "jsonMode": true,
    "systemMessage": true
  },
  "models": [
    {
      "id": "gpt-4o",
      "name": "GPT-4o",
      "contextWindow": 128000,
      "maxOutput": 16384,
      "inputPrice": 2.5,
      "outputPrice": 10.0,
      "capabilities": ["chat", "code", "vision", "function_calling", "json_mode", "streaming"],
      "default": true
    }
  ]
}
```

### 7.3 Config Loader

**Source:** `configs/index.ts` and `configs/loader.ts`

The config loader provides:

```typescript
// Load a specific provider config
loadProviderConfig(id: string): ProviderConfig | null

// Get all provider configs
getAllProviderConfigs(): ProviderConfig[]

// List all provider IDs (100+)
getAvailableProviders(): string[]

// Resolve config with API key from environment
resolveProviderConfig(id: string): ResolvedProviderConfig | null

// Get only providers with valid API keys
getConfiguredProviders(): ResolvedProviderConfig[]

// Find a model across all providers
getModelConfig(providerId: string, modelId: string): ModelConfig | null

// Get default model for a provider
getDefaultModelForProvider(providerId: string): ModelConfig | null

// Load custom provider config from a file path
loadCustomProviderConfig(configPath: string): ProviderConfig | null

// Clear in-memory cache
clearConfigCache(): void
```

**Caching**: All configs are cached in a `Map<string, ProviderConfig>` after first load. Call `clearConfigCache()` to force reload.

**Resolution**: `resolveProviderConfig()` reads the `apiKeyEnv` field from the JSON, looks up `process.env[apiKeyEnv]`, and returns a `ResolvedProviderConfig` with the actual key. Returns `null` if the environment variable is not set.

### 7.4 Model Search Functions

```typescript
// Find models matching criteria
findModels(criteria: ProviderSelectionCriteria): Array<{ provider, model }>

// Best model for criteria
selectBestModel(criteria): { provider, model } | null

// Cheapest model with given capabilities
getCheapestModel(capabilities): { provider, model } | null

// Fastest model (heuristic: smaller context + lower price)
getFastestModel(capabilities): { provider, model } | null

// Smartest model (heuristic: larger context + higher price)
getSmartestModel(capabilities): { provider, model } | null
```

---

## 8. Model Capabilities

**Source:** `packages/core/src/agent/providers/configs/types.ts`

```typescript
export type ModelCapability =
  | 'chat'             // Conversational text generation
  | 'code'             // Code generation and understanding
  | 'vision'           // Image/visual input processing
  | 'function_calling' // Tool/function calling support
  | 'json_mode'        // Structured JSON output
  | 'streaming'        // Server-sent events streaming
  | 'embeddings'       // Text embedding generation
  | 'image_generation' // Image generation (DALL-E, FLUX, etc.)
  | 'audio'            // Audio transcription/generation (Whisper, etc.)
  | 'reasoning';       // Extended reasoning (o1, DeepSeek R1, etc.)
```

### Capability Matrix (Selected Providers)

| Provider | chat | code | vision | function_calling | json_mode | streaming | reasoning |
|----------|------|------|--------|-----------------|-----------|-----------|-----------|
| OpenAI (GPT-4o) | Y | Y | Y | Y | Y | Y | - |
| OpenAI (o3) | Y | Y | - | - | - | Y | Y |
| Anthropic (Claude 3.5 Sonnet) | Y | Y | Y | Y | - | Y | - |
| Google (Gemini 2.0 Flash) | Y | Y | Y | Y | - | Y | Y |
| DeepSeek (V3) | Y | Y | - | Y | - | Y | - |
| DeepSeek (R1) | Y | Y | - | - | - | Y | Y |
| Groq (Llama 3.3 70B) | Y | Y | - | Y | Y | Y | - |
| Mistral (Large) | Y | Y | - | Y | Y | Y | - |
| xAI (Grok-3) | Y | Y | - | Y | - | Y | - |

### Capability-Gated Features

The `OpenAICompatibleProvider` checks `config.features` before including certain data in API requests:

- **Tools**: Only included if `features.toolUse === true`.
- **Vision content**: Images replaced with `[Image not supported by this provider]` if `features.vision === false`.
- **JSON mode**: `response_format: { type: "json_object" }` only if `features.jsonMode === true`.

---

## 9. Provider Presets

**Source:** `packages/core/src/agent/presets.ts`

Presets provide a quick-setup configuration for well-known providers. They are simpler than the full JSON configs and are used for programmatic provider creation.

### ProviderPreset Interface

```typescript
export interface ProviderPreset {
  readonly name: string;           // Display name
  readonly id: string;             // Provider identifier
  readonly baseUrl: string;        // API base URL
  readonly defaultModel: string;   // Default model ID
  readonly models: readonly string[]; // Available model IDs
  readonly openaiCompatible: boolean; // Whether to use OpenAI client
  readonly envVar: string;         // Environment variable name
  readonly docsUrl?: string;       // Documentation link
}
```

### Available Presets

| Preset ID | Default Model | Base URL | OpenAI Compatible |
|-----------|--------------|----------|-------------------|
| `openai` | `gpt-5` | `https://api.openai.com/v1` | Yes |
| `anthropic` | `claude-opus-4-5-20251101` | `https://api.anthropic.com/v1` | No |
| `google` | `gemini-2.0-pro` | `https://generativelanguage.googleapis.com/v1beta` | No |
| `deepseek` | `deepseek-v3.2` | `https://api.deepseek.com/v1` | Yes |
| `groq` | `llama-4-maverick` | `https://api.groq.com/openai/v1` | Yes |
| `together` | `meta-llama/Llama-4-Maverick-Instruct-Turbo` | `https://api.together.xyz/v1` | Yes |
| `mistral` | `mistral-large-3` | `https://api.mistral.ai/v1` | Yes |
| `fireworks` | `accounts/fireworks/models/llama-4-maverick-instruct` | `https://api.fireworks.ai/inference/v1` | Yes |
| `perplexity` | `sonar-pro` | `https://api.perplexity.ai` | Yes |
| `xai` | `grok-3` | `https://api.x.ai/v1` | Yes |
| `zhipu` | `glm-4.7` | `https://open.bigmodel.cn/api/paas/v4` | Yes |
| `ollama` | `llama4` | `http://localhost:11434/v1` | Yes |
| `lmstudio` | `local-model` | `http://localhost:1234/v1` | Yes |

### Preset Usage

```typescript
import { createProviderConfigFromPreset, getDefaultModelConfig } from '@ownpilot/core';

// Create a provider config from a preset
const config = createProviderConfigFromPreset('deepseek', 'sk-...');
// Result: { provider: 'openai', apiKey: 'sk-...', baseUrl: 'https://api.deepseek.com/v1', ... }

// Get default model config
const modelConfig = getDefaultModelConfig('groq');
// Result: { model: 'llama-4-maverick', maxTokens: 4096, temperature: 0.7 }
```

---

## 10. Aggregator Providers

**Source:** `packages/core/src/agent/providers/aggregators.ts`

Aggregators are third-party platforms that host multiple models through a single API. They are tracked separately from JSON-based provider configs.

### AggregatorProvider Interface

```typescript
export interface AggregatorProvider {
  id: string;                     // e.g. 'openrouter'
  name: string;                   // e.g. 'OpenRouter'
  description: string;            // Human-readable description
  apiBase: string;                // API endpoint URL
  type: 'openai_compatible' | 'custom';
  apiKeyEnv: string;              // Env var for API key
  docsUrl?: string;               // Documentation link
  defaultModels: AggregatorModel[];
}

export interface AggregatorModel {
  id: string;                     // Model ID for API calls
  name: string;                   // Display name
  capabilities: ModelCapability[];
  pricingInput?: number;          // USD per 1M input tokens
  pricingOutput?: number;         // USD per 1M output tokens
  pricingPerRequest?: number;     // USD per request (for image gen)
  contextWindow?: number;
  maxOutput?: number;
}
```

### Registered Aggregators

| Aggregator | Type | API Key Env | Notable Models |
|------------|------|-------------|----------------|
| **fal.ai** | custom | `FAL_KEY` | FLUX Pro, FLUX Schnell, SDXL, Recraft v3 (image generation) |
| **Together AI** | openai_compatible | `TOGETHER_API_KEY` | Llama 3.3 70B, Qwen 2.5 Coder, DeepSeek R1, DeepSeek V3, Mixtral 8x22B |
| **Groq** | openai_compatible | `GROQ_API_KEY` | Llama 3.3 70B, Llama 3.1 8B, Mixtral 8x7B, Whisper (audio) |
| **Fireworks AI** | openai_compatible | `FIREWORKS_API_KEY` | Llama 3.3 70B, Llama 3.2 Vision, Qwen 2.5 Coder, DeepSeek V3, FLUX.1 |
| **DeepInfra** | openai_compatible | `DEEPINFRA_API_KEY` | Llama 3.3 70B, Llama 3.2 Vision, Qwen 2.5 Coder, DeepSeek R1 |
| **OpenRouter** | openai_compatible | `OPENROUTER_API_KEY` | Claude 3.5 Sonnet, GPT-4o, Gemini 2.0 Flash (Free), DeepSeek R1, Llama 3.3 |
| **Perplexity** | openai_compatible | `PERPLEXITY_API_KEY` | Sonar Pro, Sonar, Sonar Reasoning (search-augmented) |
| **Cerebras** | openai_compatible | `CEREBRAS_API_KEY` | Llama 3.3 70B, Llama 3.1 8B (ultra-fast inference via Wafer-Scale Engine) |

### Aggregator API

```typescript
import {
  getAggregatorIds,        // ['fal', 'together', 'groq', ...]
  getAggregatorProvider,   // Get specific aggregator by ID
  getAllAggregatorProviders, // Get all aggregator configs
  isAggregatorProvider,    // Check if an ID is an aggregator
  getAggregatorModels,     // Get models for a specific aggregator
} from '@ownpilot/core';
```

---

## 11. Local Providers

Local providers run AI models on the user's own hardware or local network.

### Supported Local Provider Types

| Type | Default Port | Discovery Endpoint | Description |
|------|-------------|-------------------|-------------|
| `lmstudio` | 1234 | `/v1/models` | LM Studio desktop application |
| `ollama` | 11434 | `/api/tags` | Ollama CLI model runner |
| `localai` | 8080 | `/v1/models` | LocalAI OpenAI-compatible server |
| `vllm` | 8000 | `/v1/models` | vLLM high-throughput serving engine |
| `custom` | 8080 | `/v1/models` | Any OpenAI-compatible local server |

### Auto-Discovery

The gateway service includes a model discovery system (`packages/gateway/src/services/local-discovery.ts`) that:

1. Sends an HTTP request to the provider's discovery endpoint.
2. Parses the response to extract available model IDs.
3. Stores discovered models in the `local_models` database table.

Discovery is triggered:
- When a local provider is first added.
- Manually via the `POST /api/v1/local-providers/:id/discover` endpoint.
- From the UI's provider management page.

### Database Storage

Local providers and their models are persisted in PostgreSQL:

**`local_providers` table:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Unique provider ID |
| `user_id` | TEXT | User who added this provider |
| `name` | TEXT | Display name |
| `provider_type` | TEXT | `lmstudio`, `ollama`, `localai`, `vllm`, `custom` |
| `base_url` | TEXT | HTTP endpoint (e.g., `http://localhost:11434`) |
| `api_key` | TEXT | Optional API key |
| `discovery_endpoint` | TEXT | Model list endpoint path |
| `is_enabled` | BOOLEAN | Whether this provider is active |
| `created_at` | DATETIME | Creation timestamp |
| `updated_at` | DATETIME | Last update timestamp |

**`local_models` table:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Unique model ID |
| `provider_id` | TEXT | FK to local_providers |
| `user_id` | TEXT | User who added this |
| `model_id` | TEXT | Model identifier for API calls |
| `display_name` | TEXT | Human-readable name |
| `is_default` | BOOLEAN | Default model for this provider |
| `created_at` | DATETIME | Creation timestamp |

### Local Provider API

```
GET    /api/v1/local-providers              - List all local providers
POST   /api/v1/local-providers              - Add a new local provider
GET    /api/v1/local-providers/templates     - Get provider templates
GET    /api/v1/local-providers/:id           - Get specific provider
PUT    /api/v1/local-providers/:id           - Update provider
DELETE /api/v1/local-providers/:id           - Remove provider
PATCH  /api/v1/local-providers/:id/toggle    - Enable/disable provider
POST   /api/v1/local-providers/:id/discover  - Trigger model discovery
GET    /api/v1/local-providers/:id/models    - List discovered models
```

---

## 12. Database Layer

The gateway persists provider and model configurations in PostgreSQL, enabling per-user customization.

### Database Tables

#### `user_model_configs`

Per-user model overrides (enable/disable, display name, custom pricing).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment PK |
| `user_id` | TEXT | User identifier |
| `provider_id` | TEXT | Provider ID |
| `model_id` | TEXT | Model ID |
| `display_name` | TEXT | Custom display name |
| `is_enabled` | BOOLEAN | Enable/disable this model |
| `custom_input_price` | REAL | Override input price |
| `custom_output_price` | REAL | Override output price |
| `notes` | TEXT | User notes |
| `created_at` | DATETIME | Creation timestamp |
| `updated_at` | DATETIME | Last update timestamp |

#### `custom_providers`

User-defined providers not in the built-in list.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Unique provider ID |
| `user_id` | TEXT | User who created this |
| `name` | TEXT | Display name |
| `api_base` | TEXT | API endpoint URL |
| `api_key_setting` | TEXT | Config Center key name |
| `provider_type` | TEXT | `openai-compatible`, etc. |
| `is_enabled` | BOOLEAN | Active status |
| `description` | TEXT | Provider description |
| `notes` | TEXT | User notes |
| `created_at` | DATETIME | Creation timestamp |
| `updated_at` | DATETIME | Last update timestamp |

#### `user_provider_configs`

Per-user overrides for built-in providers (base URL, type, enabled status).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment PK |
| `user_id` | TEXT | User identifier |
| `provider_id` | TEXT | Built-in provider ID |
| `base_url` | TEXT | Override base URL |
| `provider_type` | TEXT | Override provider type |
| `is_enabled` | BOOLEAN | Enable/disable |
| `notes` | TEXT | User notes |
| `created_at` | DATETIME | Creation timestamp |
| `updated_at` | DATETIME | Last update timestamp |

### Merged View

The `model-configs` route combines data from multiple sources into a unified view:

```
Source Priority (highest to lowest):
1. user_model_configs (per-user overrides)
2. custom_providers + their models (user-created)
3. Aggregator configs (AGGREGATOR_PROVIDERS constant)
4. Built-in provider JSON configs (models.dev-synced)
5. Local providers + local_models (auto-discovered)
```

Each model in the merged view includes:

```typescript
interface MergedModel {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapability[];
  pricingInput?: number;
  pricingOutput?: number;
  contextWindow?: number;
  maxOutput?: number;
  isEnabled: boolean;       // User override or default
  isCustom: boolean;        // From custom_providers
  hasOverride: boolean;     // Has user_model_configs entry
  isConfigured: boolean;    // API key is set
  source: 'builtin' | 'aggregator' | 'custom' | 'local';
}
```

---

## 13. Gateway API Routes

### Providers Route (`/api/v1/providers`)

**Source:** `packages/gateway/src/routes/providers.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List all providers with status (configured, enabled, model count) |
| `GET` | `/:id` | Get specific provider details |
| `GET` | `/:id/config` | Get provider config with user overrides |
| `PUT` | `/:id/config` | Save user override (base URL, type, notes) |
| `DELETE` | `/:id/config` | Reset provider to defaults |
| `PATCH` | `/:id/toggle` | Enable/disable a provider |

Each provider in the list response includes:

```json
{
  "id": "openai",
  "name": "OpenAI",
  "type": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY",
  "docsUrl": "https://platform.openai.com/docs",
  "isConfigured": true,
  "isEnabled": true,
  "hasOverride": false,
  "color": "#10a37f",
  "modelCount": 12,
  "features": {
    "streaming": true,
    "toolUse": true,
    "vision": true,
    "jsonMode": true,
    "systemMessage": true
  }
}
```

### Models Route (`/api/v1/models`)

**Source:** `packages/gateway/src/routes/models.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List all models from configured providers |
| `GET` | `/providers` | List provider IDs with model counts |
| `GET` | `/:provider/:model` | Get specific model info |
| `POST` | `/sync` | Sync all providers from models.dev |
| `POST` | `/sync/:providers` | Sync specific providers |
| `GET` | `/modelsdev/providers` | List providers available on models.dev |

**Query Parameters for `GET /`:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabledOnly` | boolean | `true` | Filter to only enabled models |

### Model Configs Route (`/api/v1/model-configs`)

**Source:** `packages/gateway/src/routes/model-configs.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/models` | Get merged models from all sources |
| `GET` | `/providers` | Get merged providers from all sources |
| `POST` | `/models` | Create a custom model config |
| `PUT` | `/models/:providerId/:modelId` | Update model config |
| `DELETE` | `/models/:providerId/:modelId` | Delete model override |
| `PATCH` | `/models/:providerId/:modelId/toggle` | Toggle model enabled |
| `POST` | `/providers` | Create a custom provider |
| `PUT` | `/providers/:id` | Update custom provider |
| `DELETE` | `/providers/:id` | Delete custom provider |
| `PATCH` | `/providers/:id/toggle` | Toggle provider enabled |
| `GET` | `/aggregators` | List aggregator providers |

### Local Providers Route (`/api/v1/local-providers`)

**Source:** `packages/gateway/src/routes/local-providers.ts`

See [Section 11: Local Providers](#11-local-providers) for full endpoint listing.

---

## 14. UI Management Pages

### AIModelsPage

**Source:** `packages/ui/src/pages/AIModelsPage.tsx`

Top-level page that embeds the `AIModelsTab` component. Provides:
- Browsing all available models across all providers.
- Filtering by provider, capability, price range.
- Enabling/disabling individual models.
- Viewing model details (context window, pricing, capabilities).

### ProvidersTab

**Source:** `packages/ui/src/components/ProvidersTab.tsx`

Provider management interface with:

- **Provider list**: Cards showing each provider's name, type, base URL, model count, feature badges (Vision, Tools), and configuration status.
- **Status indicators**: Green check for configured (API key present), blue "Override" badge for user-customized providers.
- **Enable/disable toggle**: Per-provider toggle switch.
- **Search and filter**: Text search across provider names and IDs; filter by configured/unconfigured status.
- **Statistics bar**: Total providers, configured count, override count.
- **Edit modal**: Override provider type (`openai-compatible`, `openai`, `anthropic`, `google`), base URL, enabled status, and notes.
- **Reset to default**: Clear all user overrides for a provider.

**Provider type dropdown options:**

| Value | Label |
|-------|-------|
| `openai-compatible` | OpenAI Compatible (Most Providers) |
| `openai` | OpenAI (Native) |
| `anthropic` | Anthropic (Native) |
| `google` | Google Gemini (Native) |

User overrides set through this UI persist in the `user_provider_configs` database table and survive models.dev syncs.

---

## 15. Config Center Integration

API keys and service credentials are managed through the Config Center system.

### Storage

API keys are stored in the `config_services` and `config_entries` database tables, which provide:
- Named services (e.g., `openai`, `anthropic`, `google`).
- Encrypted credential storage.
- Multi-entry support (multiple API keys per service for rotation).

### Tool Context Access

Tools can access provider API keys through the `ToolContext` interface:

```typescript
export interface ToolContext {
  /** Get API key for a named service */
  readonly getApiKey?: (serviceName: string) => string | undefined;

  /** Get full service config (URL, key, custom fields) */
  readonly getServiceConfig?: (serviceName: string) => ApiServiceConfig | null;

  /** Get a config entry by service name and optional label */
  readonly getConfigEntry?: (serviceName: string, entryLabel?: string) => ConfigEntry | null;

  /** Get all config entries for a service (multi-key support) */
  readonly getConfigEntries?: (serviceName: string) => ConfigEntry[];

  /** Get a resolved field value from a service config entry */
  readonly getFieldValue?: (serviceName: string, fieldName: string, entryLabel?: string) => unknown;
}
```

**Example: A tool accessing a provider API key:**

```typescript
const executor: ToolExecutor = async (args, context) => {
  // Get OpenAI key from Config Center
  const apiKey = context.getApiKey?.('openai');
  if (!apiKey) {
    return { content: 'OpenAI API key not configured', isError: true };
  }

  // Use the key for a direct API call
  const response = await fetch('https://api.openai.com/v1/...', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  // ...
};
```

### Key Resolution Order

When the gateway checks if a provider is configured:

1. **Config Center** (database `config_entries`): Checked first via `hasApiKey()`.
2. **Environment variables**: Falls back to `process.env[provider.apiKeyEnv]`.

---

## 16. Retry and Error Handling

**Source:** `packages/core/src/agent/retry.ts`

### RetryConfig

```typescript
export interface RetryConfig {
  maxRetries?: number;        // Default: 3
  initialDelayMs?: number;    // Default: 1000
  maxDelayMs?: number;        // Default: 10000
  backoffMultiplier?: number; // Default: 2
  addJitter?: boolean;        // Default: true (+-25% jitter)
  retryableErrors?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}
```

### Exponential Backoff Calculation

```
delay = min(initialDelay * multiplier^attempt, maxDelay)
       +/- 25% jitter (if enabled)
```

For defaults (1000ms initial, 2x multiplier, 10000ms max):

| Attempt | Base Delay | With Jitter Range |
|---------|-----------|-------------------|
| 1 | 1000ms | 750ms - 1250ms |
| 2 | 2000ms | 1500ms - 2500ms |
| 3 | 4000ms | 3000ms - 5000ms |
| 4+ | 8000ms | 6000ms - 10000ms |

### Retryable Error Detection

The `isRetryableError()` function checks for:

| Error Pattern | Retryable | Example |
|---------------|-----------|---------|
| `TimeoutError` | Yes | Request exceeded timeout |
| Network errors | Yes | `ECONNRESET`, `ECONNREFUSED`, `network` |
| Rate limits | Yes | `429`, `rate limit`, `too many requests` |
| Server errors | Yes | `500`, `502`, `503`, `504` |
| Service unavailable | Yes | `temporarily unavailable`, `service unavailable` |
| Google request failures | Yes | `google request ... failed` |
| All other errors | No | Validation errors, auth errors |

### withRetry Usage

```typescript
import { withRetry } from '@ownpilot/core';

const result = await withRetry(async () => {
  // This function will be retried on transient failures
  const response = await fetch(url, options);
  if (!response.ok) {
    return err(new InternalError(`HTTP ${response.status}`));
  }
  return ok(await response.json());
}, {
  maxRetries: 3,
  initialDelayMs: 1000,
  onRetry: (attempt, error, delayMs) => {
    console.log(`Retry ${attempt}: ${error} (waiting ${delayMs}ms)`);
  },
});
```

### Debug Logging

**Source:** `packages/core/src/agent/debug.ts`

Every provider call is logged through the debug system:

- `logRequest()`: Logs provider, model, endpoint, message count, tool count, payload size breakdown.
- `logResponse()`: Logs provider, model, duration, content preview, tool calls, usage, finish reason.
- `logError()`: Logs provider, error type, context.
- `logRetry()`: Logs attempt number, max attempts, error, delay.
- `calculatePayloadBreakdown()`: Breaks down JSON body size by top-level field (messages, tools, etc.).

---

## 17. Models.dev Sync

**Source:** `packages/core/src/agent/providers/configs/sync.ts`

The system can automatically sync provider and model data from the [models.dev](https://models.dev) public API.

### Sync Process

1. Fetches `https://models.dev/api.json` (complete catalog of providers and models).
2. For each provider, converts the models.dev format to OwnPilot's `ProviderConfig` format.
3. Maps capabilities: `tool_call` -> `function_calling`, `structured_output` -> `json_mode`, `reasoning` -> `reasoning`, image/video/audio modalities -> `vision`/`audio`.
4. **Merges** with existing config files, preserving protected fields.
5. Writes updated JSON files to `data/providers/`.

### Protected Fields

These fields are **never overwritten** by sync, preserving manual configurations:

- `type` -- Provider type (which client to use)
- `baseUrl` -- API endpoint URL
- `apiKeyEnv` -- Environment variable name

### Canonical Overrides

For known providers, canonical configurations are **always enforced** regardless of sync data:

```typescript
const CANONICAL_CONFIGS = {
  'openai':    { type: 'openai',            baseUrl: 'https://api.openai.com/v1',    apiKeyEnv: 'OPENAI_API_KEY' },
  'anthropic': { type: 'anthropic',         baseUrl: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  'google':    { type: 'google',            baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  'groq':      { type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY' },
  'mistral':   { type: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1',   apiKeyEnv: 'MISTRAL_API_KEY' },
  'xai':       { type: 'openai-compatible', baseUrl: 'https://api.x.ai/v1',         apiKeyEnv: 'XAI_API_KEY' },
  // ... and more
};
```

This guarantees that even if models.dev returns incorrect metadata, the provider will always use the correct API client.

### Sync API

```typescript
// Sync all providers from models.dev
const result = await syncAllProviders();
// { synced: ['openai', 'anthropic', ...], failed: [], total: 70 }

// Sync specific providers
const result = await syncProviders(['openai', 'anthropic', 'google']);
// { synced: ['openai', 'anthropic', 'google'], failed: [], notFound: [] }

// List providers available on models.dev (without syncing)
const providers = await listModelsDevProviders();
// [{ id: 'openai', name: 'OpenAI', modelCount: 25 }, ...]
```

### Sync via API

```
POST /api/v1/models/sync              - Sync all providers
POST /api/v1/models/sync/:providers   - Sync specific providers (comma-separated)
GET  /api/v1/models/modelsdev/providers - List models.dev providers
```

---

## 18. Adding a New Provider

### Option 1: JSON Config (Recommended)

Create a new JSON file at `data/providers/<provider-id>.json`:

```json
{
  "id": "newprovider",
  "name": "New Provider",
  "type": "openai-compatible",
  "baseUrl": "https://api.newprovider.com/v1",
  "apiKeyEnv": "NEWPROVIDER_API_KEY",
  "docsUrl": "https://docs.newprovider.com",
  "features": {
    "streaming": true,
    "toolUse": true,
    "vision": false,
    "jsonMode": true,
    "systemMessage": true
  },
  "models": [
    {
      "id": "newprovider-large",
      "name": "New Provider Large",
      "contextWindow": 128000,
      "maxOutput": 8192,
      "inputPrice": 3.0,
      "outputPrice": 15.0,
      "capabilities": ["chat", "code", "function_calling", "json_mode", "streaming"],
      "default": true
    }
  ]
}
```

The sync system will automatically discover new provider JSON files in `data/providers/`. Alternatively, add the provider ID to the `PROVIDER_IDS` array in `configs/index.ts`.

If the provider uses the OpenAI API format, no code changes are needed. The `OpenAICompatibleProvider` will handle it automatically.

If the provider needs a canonical configuration (to prevent sync from overwriting critical fields), add it to `CANONICAL_CONFIGS` in `configs/sync.ts`.

### Option 2: Custom Provider Class

For providers with non-OpenAI-compatible APIs (like Anthropic or Google), create a new class:

1. Create `packages/core/src/agent/providers/newprovider.ts`.
2. Implement the `IProvider` interface (or extend `BaseProvider`).
3. Add the provider to the `createProvider()` factory in `provider.ts`.
4. Add the type to the `AIProvider` union in `types.ts`.
5. Export from `providers/index.ts`.

### Option 3: User-Created (Runtime)

Users can add providers through the UI or API without code changes:

```
POST /api/v1/model-configs/providers
{
  "name": "My Custom Provider",
  "apiBase": "https://my-server.com/v1",
  "apiKeySetting": "my_custom_key",
  "providerType": "openai-compatible",
  "description": "My self-hosted model server"
}
```

### Option 4: Local Provider (Runtime)

For local inference servers:

```
POST /api/v1/local-providers
{
  "name": "My Ollama Server",
  "providerType": "ollama",
  "baseUrl": "http://192.168.1.100:11434",
  "discoveryEndpoint": "/api/tags"
}
```

---

## Environment Variables Reference

All provider API keys as environment variables:

| Variable | Provider |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI (Gemini) |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GROQ_API_KEY` | Groq |
| `MISTRAL_API_KEY` | Mistral AI |
| `XAI_API_KEY` | xAI (Grok) |
| `TOGETHER_API_KEY` | Together AI |
| `FIREWORKS_API_KEY` | Fireworks AI |
| `PERPLEXITY_API_KEY` | Perplexity |
| `COHERE_API_KEY` | Cohere |
| `OPENROUTER_API_KEY` | OpenRouter |
| `ZHIPU_API_KEY` | Zhipu AI |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI |
| `GOOGLE_VERTEX_API_KEY` | Google Vertex AI |
| `DASHSCOPE_API_KEY` | Alibaba DashScope |
| `DEEPINFRA_API_KEY` | DeepInfra |
| `CEREBRAS_API_KEY` | Cerebras |
| `FAL_KEY` | fal.ai |
| `NVIDIA_API_KEY` | NVIDIA |
| `MOONSHOT_API_KEY` | Moonshot AI |
| `HF_TOKEN` | Hugging Face |
| `GITHUB_TOKEN` | GitHub Models |
| `VULTR_API_KEY` | Vultr |

---

## Source File Index

| File | Description |
|------|-------------|
| `packages/core/src/agent/types.ts` | AIProvider type, Message, CompletionRequest/Response, ToolContext |
| `packages/core/src/agent/provider.ts` | IProvider interface, BaseProvider, OpenAIProvider, AnthropicProvider, createProvider() |
| `packages/core/src/agent/providers/google.ts` | GoogleProvider (native Gemini API) |
| `packages/core/src/agent/providers/openai-compatible.ts` | OpenAICompatibleProvider + factory functions |
| `packages/core/src/agent/providers/zhipu.ts` | ZhipuProvider (alias for OpenAICompatible) |
| `packages/core/src/agent/providers/router.ts` | ProviderRouter, RoutingStrategy, routing helpers |
| `packages/core/src/agent/providers/fallback.ts` | FallbackProvider, FallbackProviderConfig |
| `packages/core/src/agent/providers/aggregators.ts` | AggregatorProvider definitions |
| `packages/core/src/agent/providers/configs/types.ts` | ModelCapability, ModelConfig, ProviderConfig, ProviderFeatures |
| `packages/core/src/agent/providers/configs/index.ts` | Config loading, model search, PROVIDER_IDS |
| `packages/core/src/agent/providers/configs/loader.ts` | JSON config loader, findModels, scoring |
| `packages/core/src/agent/providers/configs/sync.ts` | Models.dev sync, canonical configs |
| `packages/core/src/agent/providers/index.ts` | Module exports |
| `packages/core/src/agent/presets.ts` | ProviderPreset definitions |
| `packages/core/src/agent/retry.ts` | Retry with exponential backoff |
| `packages/core/src/agent/debug.ts` | Debug logging for provider calls |
| `packages/gateway/src/routes/providers.ts` | Provider management API |
| `packages/gateway/src/routes/models.ts` | Model listing API |
| `packages/gateway/src/routes/model-configs.ts` | Model config CRUD API |
| `packages/gateway/src/routes/local-providers.ts` | Local provider management API |
| `packages/ui/src/pages/AIModelsPage.tsx` | AI Models browsing page |
| `packages/ui/src/components/ProvidersTab.tsx` | Provider management UI |
