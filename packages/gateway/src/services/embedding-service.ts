/**
 * Embedding Service
 *
 * Generates text embeddings via the OpenAI embeddings API.
 * Uses EmbeddingCacheRepository for LRU caching to avoid redundant API calls.
 */

import { getLog } from './log.js';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { EmbeddingCacheRepository, embeddingCacheRepo } from '../db/repositories/embedding-cache.js';
import {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_BATCH_SIZE,
  EMBEDDING_RATE_LIMIT_DELAY_MS,
} from '../config/defaults.js';

const log = getLog('EmbeddingService');

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingResult {
  embedding: number[];
  cached: boolean;
}

// ============================================================================
// Service
// ============================================================================

export class EmbeddingService {
  private modelName: string;
  private dimensions: number;
  private cache: EmbeddingCacheRepository;

  constructor(modelName = EMBEDDING_MODEL, dimensions = EMBEDDING_DIMENSIONS) {
    this.modelName = modelName;
    this.dimensions = dimensions;
    this.cache = embeddingCacheRepo;
  }

  /**
   * Get the OpenAI API key.
   * Resolution: Config Center → settings DB → environment variable.
   */
  private getApiKey(): string {
    // Config Center (synchronous, cached)
    const ccKey = configServicesRepo.getApiKey('openai');
    if (ccKey) return ccKey;

    // Environment variable fallback
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

    throw new Error('OpenAI API key not configured. Set it via Config Center or OPENAI_API_KEY env var.');
  }

  /**
   * Get the API base URL (for custom endpoints / Azure).
   */
  private getBaseUrl(): string {
    const customUrl = configServicesRepo.getFieldValue('openai', 'base_url');
    if (typeof customUrl === 'string' && customUrl.length > 0) return customUrl;
    return 'https://api.openai.com/v1';
  }

  /**
   * Generate embedding for a single text. Uses cache first.
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      throw new Error('Cannot generate embedding for empty text');
    }

    // Check cache
    const hash = EmbeddingCacheRepository.contentHash(normalizedText);
    const cached = await this.cache.lookup(hash, this.modelName);
    if (cached) {
      return { embedding: cached, cached: true };
    }

    // Call API
    const embeddings = await this.callEmbeddingAPI([normalizedText]);
    const embedding = embeddings[0]!;

    // Store in cache (fire-and-forget)
    this.cache.store(hash, this.modelName, embedding).catch(err => {
      log.warn('Failed to cache embedding', String(err));
    });

    return { embedding, cached: false };
  }

  /**
   * Generate embeddings for a batch of texts.
   * Uses cache for each text individually, only sends uncached to API.
   */
  async generateBatchEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]!.trim();
      if (!text) {
        results[i] = { embedding: [], cached: true };
        continue;
      }
      const hash = EmbeddingCacheRepository.contentHash(text);
      const cached = await this.cache.lookup(hash, this.modelName);
      if (cached) {
        results[i] = { embedding: cached, cached: true };
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(text);
      }
    }

    if (uncachedTexts.length === 0) return results;

    // Batch API call (chunk into MAX_BATCH_SIZE)
    for (let offset = 0; offset < uncachedTexts.length; offset += EMBEDDING_MAX_BATCH_SIZE) {
      const batch = uncachedTexts.slice(offset, offset + EMBEDDING_MAX_BATCH_SIZE);
      const batchIndices = uncachedIndices.slice(offset, offset + EMBEDDING_MAX_BATCH_SIZE);

      const embeddings = await this.callEmbeddingAPI(batch);

      for (let j = 0; j < embeddings.length; j++) {
        const idx = batchIndices[j]!;
        const embedding = embeddings[j]!;
        results[idx] = { embedding, cached: false };

        // Cache (fire-and-forget)
        const hash = EmbeddingCacheRepository.contentHash(batch[j]!);
        this.cache.store(hash, this.modelName, embedding).catch(() => {});
      }

      // Rate limit between batches
      if (offset + EMBEDDING_MAX_BATCH_SIZE < uncachedTexts.length) {
        await sleep(EMBEDDING_RATE_LIMIT_DELAY_MS);
      }
    }

    return results;
  }

  /**
   * Low-level call to OpenAI embeddings API.
   */
  private async callEmbeddingAPI(inputs: string[], retried = false): Promise<number[][]> {
    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        input: inputs,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');

      // Handle rate limiting with retry-after (one retry)
      if (response.status === 429 && !retried) {
        const retryAfter = parseInt(response.headers.get('retry-after') ?? '5', 10);
        log.warn(`Rate limited, retrying after ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        return this.callEmbeddingAPI(inputs, true);
      }

      log.error('Embedding API call failed', {
        status: response.status,
        body: errorBody.substring(0, 500),
      });

      throw new Error(`Embedding API error: ${response.status} - ${errorBody.substring(0, 200)}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }

  /**
   * Check if embedding generation is available (API key configured).
   */
  isAvailable(): boolean {
    try {
      this.getApiKey();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Singleton
// ============================================================================

let instance: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!instance) {
    instance = new EmbeddingService();
  }
  return instance;
}
