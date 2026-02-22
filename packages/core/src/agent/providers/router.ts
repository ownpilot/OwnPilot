/**
 * Provider Router - Smart AI Provider Selection
 *
 * Automatically selects the best provider based on:
 * - Task requirements (capabilities)
 * - Cost optimization
 * - Speed requirements
 * - Availability (configured API keys)
 */

import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { InternalError, ValidationError, TimeoutError } from '../../types/errors.js';
import type { CompletionRequest, CompletionResponse, StreamChunk } from '../types.js';
import {
  getConfiguredProviders,
  findModels,
  selectBestModel,
  getCheapestModel,
  getFastestModel,
  getSmartestModel,
  type ProviderSelectionCriteria,
  type ModelCapability,
  type ResolvedProviderConfig,
  type ModelConfig,
} from './configs/index.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { GoogleProvider } from './google.js';

/**
 * Routing strategy
 */
export type RoutingStrategy =
  | 'cheapest' // Minimize cost
  | 'fastest' // Minimize latency
  | 'smartest' // Best quality/reasoning
  | 'balanced' // Balance cost/quality
  | 'fallback'; // Try providers in order until one works

/**
 * Router configuration
 */
export interface RouterConfig {
  /** Default routing strategy */
  defaultStrategy?: RoutingStrategy;
  /** Fallback provider order */
  fallbackOrder?: string[];
  /** Maximum retries on failure */
  maxRetries?: number;
  /** Required capabilities for all requests */
  requiredCapabilities?: ModelCapability[];
  /** Excluded providers */
  excludedProviders?: string[];
}

/**
 * Routing result with metadata
 */
export interface RoutingResult {
  providerId: string;
  modelId: string;
  provider: OpenAICompatibleProvider | GoogleProvider;
  modelConfig: ModelConfig;
  estimatedCost: {
    inputPer1M: number;
    outputPer1M: number;
  };
}

/**
 * Provider Router
 *
 * Smart routing between multiple AI providers based on:
 * - Cost (cheapest option)
 * - Speed (fastest inference)
 * - Quality (best for complex tasks)
 * - Availability (fallback handling)
 */
export class ProviderRouter {
  private readonly config: Required<RouterConfig>;
  private providerCache: Map<string, OpenAICompatibleProvider | GoogleProvider> = new Map();

  constructor(config: RouterConfig = {}) {
    this.config = {
      defaultStrategy: config.defaultStrategy ?? 'balanced',
      fallbackOrder: config.fallbackOrder ?? ['anthropic', 'openai', 'google', 'deepseek', 'groq'],
      maxRetries: config.maxRetries ?? 3,
      requiredCapabilities: config.requiredCapabilities ?? [],
      excludedProviders: config.excludedProviders ?? [],
    };
  }

  /**
   * Get available (configured) providers
   */
  getAvailableProviders(): ResolvedProviderConfig[] {
    return getConfiguredProviders().filter((p) => !this.config.excludedProviders.includes(p.id));
  }

  /**
   * Select provider and model based on criteria
   */
  selectProvider(
    criteria: ProviderSelectionCriteria = {},
    strategy: RoutingStrategy = this.config.defaultStrategy
  ): Result<RoutingResult, ValidationError> {
    // Merge required capabilities
    const allCapabilities = [
      ...new Set([...this.config.requiredCapabilities, ...(criteria.capabilities ?? [])]),
    ];

    const mergedCriteria: ProviderSelectionCriteria = {
      ...criteria,
      capabilities: allCapabilities,
      excludedProviders: [...this.config.excludedProviders, ...(criteria.excludedProviders ?? [])],
    };

    let selection: { provider: { id: string }; model: ModelConfig } | null = null;

    switch (strategy) {
      case 'cheapest':
        selection = getCheapestModel(allCapabilities as ModelCapability[]);
        break;
      case 'fastest':
        selection = getFastestModel(allCapabilities as ModelCapability[]);
        break;
      case 'smartest':
        selection = getSmartestModel(allCapabilities as ModelCapability[]);
        break;
      case 'balanced':
      case 'fallback':
      default:
        selection = selectBestModel(mergedCriteria);
        break;
    }

    if (!selection) {
      return err(
        new ValidationError(
          'No suitable provider found. Check that you have API keys configured and the required capabilities are available.'
        )
      );
    }

    // Get or create provider instance
    const provider = this.getOrCreateProvider(selection.provider.id);
    if (!provider) {
      return err(new ValidationError(`Failed to create provider: ${selection.provider.id}`));
    }

    return ok({
      providerId: selection.provider.id,
      modelId: selection.model.id,
      provider,
      modelConfig: selection.model,
      estimatedCost: {
        inputPer1M: selection.model.inputPrice,
        outputPer1M: selection.model.outputPrice,
      },
    });
  }

  /**
   * Complete request with automatic provider selection
   */
  async complete(
    request: CompletionRequest,
    criteria?: ProviderSelectionCriteria,
    strategy?: RoutingStrategy
  ): Promise<
    Result<
      CompletionResponse & { routingInfo: RoutingResult },
      InternalError | ValidationError | TimeoutError
    >
  > {
    const selectionResult = this.selectProvider(criteria, strategy);
    if (!selectionResult.ok) {
      return selectionResult;
    }

    const { provider, modelId, ...routingInfo } = selectionResult.value;

    // Override model in request if not specified
    const finalRequest: CompletionRequest = {
      ...request,
      model: {
        ...request.model,
        model: request.model.model || modelId,
      },
    };

    const result = await provider.complete(finalRequest);
    if (!result.ok) {
      return result;
    }

    return ok({
      ...result.value,
      routingInfo: { provider, modelId, ...routingInfo },
    });
  }

  /**
   * Stream request with automatic provider selection
   */
  async *stream(
    request: CompletionRequest,
    criteria?: ProviderSelectionCriteria,
    strategy?: RoutingStrategy
  ): AsyncGenerator<
    Result<StreamChunk & { routingInfo?: RoutingResult }, InternalError | ValidationError>
  > {
    const selectionResult = this.selectProvider(criteria, strategy);
    if (!selectionResult.ok) {
      yield selectionResult;
      return;
    }

    const { provider, modelId, ...routingInfo } = selectionResult.value;

    // Override model in request if not specified
    const finalRequest: CompletionRequest = {
      ...request,
      model: {
        ...request.model,
        model: request.model.model || modelId,
      },
    };

    // Yield routing info on first chunk
    let first = true;
    for await (const chunk of provider.stream(finalRequest)) {
      if (!chunk.ok) {
        yield chunk;
        continue;
      }

      if (first) {
        yield ok({
          ...chunk.value,
          routingInfo: { provider, modelId, ...routingInfo },
        });
        first = false;
      } else {
        yield chunk;
      }
    }
  }

  /**
   * Complete with fallback - try multiple providers
   */
  async completeWithFallback(
    request: CompletionRequest,
    criteria?: ProviderSelectionCriteria
  ): Promise<
    Result<
      CompletionResponse & { routingInfo: RoutingResult; attempts: string[] },
      InternalError | ValidationError
    >
  > {
    const attempts: string[] = [];
    const errors: string[] = [];

    // Get all matching models sorted by preference
    const allCapabilities = [
      ...new Set([...this.config.requiredCapabilities, ...(criteria?.capabilities ?? [])]),
    ];

    const candidates = findModels({
      ...criteria,
      capabilities: allCapabilities as ModelCapability[],
      excludedProviders: this.config.excludedProviders,
    });

    // Try each candidate
    for (const candidate of candidates.slice(0, this.config.maxRetries)) {
      const providerId = candidate.provider.id;
      attempts.push(providerId);

      const provider = this.getOrCreateProvider(providerId);
      if (!provider) {
        errors.push(`${providerId}: Failed to create provider`);
        continue;
      }

      const finalRequest: CompletionRequest = {
        ...request,
        model: {
          ...request.model,
          model: candidate.model.id,
        },
      };

      const result = await provider.complete(finalRequest);
      if (result.ok) {
        return ok({
          ...result.value,
          routingInfo: {
            providerId,
            modelId: candidate.model.id,
            provider,
            modelConfig: candidate.model,
            estimatedCost: {
              inputPer1M: candidate.model.inputPrice,
              outputPer1M: candidate.model.outputPrice,
            },
          },
          attempts,
        });
      }

      errors.push(`${providerId}: ${result.error.message}`);
    }

    return err(
      new InternalError(
        `All providers failed after ${attempts.length} attempts:\n${errors.join('\n')}`
      )
    );
  }

  /**
   * Estimate cost for a request
   */
  estimateCost(
    inputTokens: number,
    outputTokens: number,
    criteria?: ProviderSelectionCriteria,
    strategy?: RoutingStrategy
  ): Result<{ providerId: string; modelId: string; estimatedCost: number }, ValidationError> {
    const selection = this.selectProvider(criteria, strategy);
    if (!selection.ok) {
      return selection;
    }

    const { providerId, modelId, estimatedCost } = selection.value;
    const totalCost =
      (inputTokens / 1_000_000) * estimatedCost.inputPer1M +
      (outputTokens / 1_000_000) * estimatedCost.outputPer1M;

    return ok({
      providerId,
      modelId,
      estimatedCost: totalCost,
    });
  }

  /**
   * Get or create a provider instance
   */
  private getOrCreateProvider(
    providerId: string
  ): OpenAICompatibleProvider | GoogleProvider | null {
    // Check cache
    if (this.providerCache.has(providerId)) {
      return this.providerCache.get(providerId)!;
    }

    let provider: OpenAICompatibleProvider | GoogleProvider | null = null;

    // Create provider based on type
    if (providerId === 'google') {
      provider = GoogleProvider.fromEnv();
    } else {
      provider = OpenAICompatibleProvider.fromProviderId(providerId);
    }

    if (provider) {
      this.providerCache.set(providerId, provider);
    }

    return provider;
  }

  /**
   * Clear provider cache
   */
  clearCache(): void {
    this.providerCache.clear();
  }
}

/**
 * Default router instance
 */
let defaultRouter: ProviderRouter | null = null;

/**
 * Get or create default router
 */
export function getDefaultRouter(): ProviderRouter {
  if (!defaultRouter) {
    defaultRouter = new ProviderRouter();
  }
  return defaultRouter;
}

/**
 * Create a new router with custom config
 */
export function createRouter(config?: RouterConfig): ProviderRouter {
  return new ProviderRouter(config);
}

/**
 * Quick helper: Complete with best available provider
 */
export async function routedComplete(
  request: CompletionRequest,
  criteria?: ProviderSelectionCriteria,
  strategy?: RoutingStrategy
): Promise<Result<CompletionResponse, InternalError | ValidationError | TimeoutError>> {
  const router = getDefaultRouter();
  const result = await router.complete(request, criteria, strategy);
  if (!result.ok) {
    return result;
  }
  // Strip routing info for simple usage
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { routingInfo, ...response } = result.value;
  return ok(response);
}

/**
 * Quick helper: Get cheapest provider for capabilities
 */
export function getCheapestProvider(
  capabilities: ModelCapability[] = ['chat']
): Result<RoutingResult, ValidationError> {
  return getDefaultRouter().selectProvider({ capabilities }, 'cheapest');
}

/**
 * Quick helper: Get fastest provider for capabilities
 */
export function getFastestProvider(
  capabilities: ModelCapability[] = ['chat']
): Result<RoutingResult, ValidationError> {
  return getDefaultRouter().selectProvider({ capabilities }, 'fastest');
}

/**
 * Quick helper: Get smartest provider for complex tasks
 */
export function getSmartestProvider(
  capabilities: ModelCapability[] = ['chat']
): Result<RoutingResult, ValidationError> {
  return getDefaultRouter().selectProvider({ capabilities }, 'smartest');
}
