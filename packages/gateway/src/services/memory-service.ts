/**
 * Memory Service
 *
 * Central business logic for memory operations.
 * Both HTTP routes and tool executors delegate here.
 */

import {
  getEventBus,
  createEvent,
  EventTypes,
  getServiceRegistry,
  Services,
  type IMemoryService,
  type ResourceCreatedData,
  type ResourceUpdatedData,
  type ResourceDeletedData,
} from '@ownpilot/core';
import {
  MemoriesRepository,
  createMemoriesRepository,
  type Memory,
  type MemoryType,
  type MemoryQuery,
  type CreateMemoryInput,
  type UpdateMemoryInput,
} from '../db/repositories/memories.js';
import { getEmbeddingQueue } from './embedding-queue.js';
import { shouldChunk, chunkMarkdown } from './chunking.js';
import { getLog } from './log.js';

const log = getLog('MemoryService');

// ============================================================================
// Types
// ============================================================================

export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  avgImportance: number;
  recentCount: number;
}

// ============================================================================
// MemoryService
// ============================================================================

export class MemoryService implements IMemoryService {
  private getRepo(userId: string): MemoriesRepository {
    return createMemoriesRepository(userId);
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async createMemory(userId: string, input: CreateMemoryInput): Promise<Memory> {
    if (!input.content?.trim()) {
      throw new MemoryServiceError('Content is required', 'VALIDATION_ERROR');
    }
    if (!input.type) {
      throw new MemoryServiceError('Type is required', 'VALIDATION_ERROR');
    }

    // Handle chunking for long content
    if (shouldChunk(input.content)) {
      return this.createChunkedMemory(userId, input);
    }

    const repo = this.getRepo(userId);
    const memory = await repo.create(input);

    // Queue embedding generation (async, non-blocking)
    if (!input.embedding) {
      getEmbeddingQueue().enqueue(memory.id, userId, memory.content);
    }

    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'memory-service',
      { resourceType: 'memory', id: memory.id },
    ));
    return memory;
  }

  /**
   * Create a long memory with chunks.
   * Parent memory stores full content, child chunks store segments.
   */
  private async createChunkedMemory(userId: string, input: CreateMemoryInput): Promise<Memory> {
    const repo = this.getRepo(userId);
    const chunks = chunkMarkdown(input.content);

    // Create parent memory
    const parentMemory = await repo.create({
      ...input,
      metadata: {
        ...input.metadata,
        isParent: true,
        chunkCount: chunks.length,
      },
    });

    // Create child chunk memories and enqueue embeddings
    const chunkIds: string[] = [];
    for (const chunk of chunks) {
      const chunkMemory = await repo.create({
        type: input.type,
        content: chunk.text,
        source: 'chunk',
        sourceId: parentMemory.id,
        importance: input.importance ?? 0.5,
        tags: input.tags,
        metadata: {
          parentId: parentMemory.id,
          chunkIndex: chunk.index,
          headingContext: chunk.headingContext,
        },
      });
      chunkIds.push(chunkMemory.id);

      // Queue embedding for each chunk
      getEmbeddingQueue().enqueue(chunkMemory.id, userId, chunk.text);
    }

    // Update parent with chunk IDs
    await repo.update(parentMemory.id, {
      metadata: {
        ...parentMemory.metadata,
        isParent: true,
        chunkCount: chunks.length,
        chunks: chunkIds,
      },
    });

    // Also queue embedding for the parent (full content — truncated by API if too long)
    getEmbeddingQueue().enqueue(parentMemory.id, userId, input.content);

    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'memory-service',
      { resourceType: 'memory', id: parentMemory.id },
    ));

    log.info(`Created chunked memory: ${chunks.length} chunks`, { parentId: parentMemory.id });
    return parentMemory;
  }

  /**
   * Remember with automatic deduplication.
   * If a similar memory exists, boosts it instead of creating a duplicate.
   */
  async rememberMemory(
    userId: string,
    input: CreateMemoryInput,
  ): Promise<{ memory: Memory; deduplicated: boolean }> {
    if (!input.content?.trim()) {
      throw new MemoryServiceError('Content is required', 'VALIDATION_ERROR');
    }
    if (!input.type) {
      throw new MemoryServiceError('Type is required', 'VALIDATION_ERROR');
    }

    const repo = this.getRepo(userId);

    // Check for duplicates (uses embedding similarity when available)
    const existing = await repo.findSimilar(input.content, input.type, input.embedding);
    if (existing) {
      await repo.boost(existing.id, 0.1);
      const boosted = await repo.get(existing.id);
      return { memory: boosted ?? existing, deduplicated: true };
    }

    const memory = await repo.create(input);

    // Queue embedding generation for new memories
    if (!input.embedding) {
      getEmbeddingQueue().enqueue(memory.id, userId, memory.content);
    }

    return { memory, deduplicated: false };
  }

  /**
   * Batch remember with automatic deduplication for each entry.
   */
  async batchRemember(
    userId: string,
    memories: CreateMemoryInput[],
  ): Promise<{ created: number; deduplicated: number; memories: Memory[] }> {
    const results = { created: 0, deduplicated: 0, memories: [] as Memory[] };

    for (const input of memories) {
      if (!input.content?.trim() || !input.type) continue;

      const { memory, deduplicated } = await this.rememberMemory(userId, input);
      if (deduplicated) {
        results.deduplicated++;
      } else {
        results.created++;
      }
      results.memories.push(memory);
    }

    return results;
  }

  async getMemory(userId: string, id: string, trackAccess = true): Promise<Memory | null> {
    const repo = this.getRepo(userId);
    return repo.get(id, trackAccess);
  }

  async updateMemory(userId: string, id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    const repo = this.getRepo(userId);
    const updated = await repo.update(id, input);
    if (updated) {
      getEventBus().emit(createEvent<ResourceUpdatedData>(
        EventTypes.RESOURCE_UPDATED, 'resource', 'memory-service',
        { resourceType: 'memory', id, changes: input },
      ));
    }
    return updated;
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    const repo = this.getRepo(userId);
    const deleted = await repo.delete(id);
    if (deleted) {
      getEventBus().emit(createEvent<ResourceDeletedData>(
        EventTypes.RESOURCE_DELETED, 'resource', 'memory-service',
        { resourceType: 'memory', id },
      ));
    }
    return deleted;
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  async listMemories(userId: string, query: MemoryQuery = {}): Promise<Memory[]> {
    const repo = this.getRepo(userId);
    return repo.list(query);
  }

  async searchMemories(
    userId: string,
    searchQuery: string,
    options: { type?: MemoryType; limit?: number } = {},
  ): Promise<Memory[]> {
    const repo = this.getRepo(userId);
    return repo.search(searchQuery, options);
  }

  /**
   * Search memories using vector similarity (pgvector cosine distance).
   * Requires a pre-computed embedding vector.
   */
  async searchByEmbedding(
    userId: string,
    embedding: number[],
    options: {
      type?: MemoryType;
      limit?: number;
      threshold?: number;
      minImportance?: number;
    } = {},
  ): Promise<Array<Memory & { similarity: number }>> {
    const repo = this.getRepo(userId);
    return repo.searchByEmbedding(embedding, options);
  }

  /**
   * Hybrid search: vector + FTS + RRF ranking.
   * Generates embedding for the query text on-the-fly.
   * Falls back gracefully if embedding service is unavailable.
   */
  async hybridSearch(
    userId: string,
    query: string,
    options: {
      type?: MemoryType;
      limit?: number;
      minImportance?: number;
    } = {},
  ): Promise<Array<Memory & { score: number; matchType: string }>> {
    const repo = this.getRepo(userId);

    // Try to generate embedding for the query
    let queryEmbedding: number[] | undefined;
    try {
      const embeddingService = getServiceRegistry().get(Services.Embedding);
      if (embeddingService.isAvailable()) {
        const result = await embeddingService.generateEmbedding(query);
        queryEmbedding = result.embedding;
      }
    } catch (err) {
      // Embedding unavailable — proceed with FTS-only
      log.debug('Query embedding generation failed, falling back to FTS', String(err));
    }

    return repo.hybridSearch(query, {
      embedding: queryEmbedding,
      type: options.type,
      limit: options.limit,
      minImportance: options.minImportance,
    });
  }

  /**
   * Get memories that are missing embeddings (for backfill).
   */
  async getWithoutEmbeddings(userId: string, limit = 100): Promise<Memory[]> {
    const repo = this.getRepo(userId);
    return repo.getWithoutEmbeddings(limit);
  }

  /**
   * Update the embedding for an existing memory (backfill support).
   */
  async updateEmbedding(userId: string, id: string, embedding: number[]): Promise<boolean> {
    const repo = this.getRepo(userId);
    return repo.updateEmbedding(id, embedding);
  }

  async getImportantMemories(
    userId: string,
    options?: { threshold?: number; limit?: number },
  ): Promise<Memory[]> {
    const repo = this.getRepo(userId);
    return repo.getImportant(options?.threshold ?? 0.7, options?.limit ?? 20);
  }

  async getRecentMemories(userId: string, limit = 20): Promise<Memory[]> {
    const repo = this.getRepo(userId);
    return repo.getRecent(limit);
  }

  async getFrequentlyAccessedMemories(userId: string, limit = 20): Promise<Memory[]> {
    const repo = this.getRepo(userId);
    return repo.getFrequentlyAccessed(limit);
  }

  async getBySource(userId: string, source: string, sourceId?: string): Promise<Memory[]> {
    const repo = this.getRepo(userId);
    return repo.getBySource(source, sourceId);
  }

  // --------------------------------------------------------------------------
  // Stats & Maintenance
  // --------------------------------------------------------------------------

  async getStats(userId: string): Promise<MemoryStats> {
    const repo = this.getRepo(userId);
    return repo.getStats();
  }

  async countMemories(userId: string, type?: MemoryType): Promise<number> {
    const repo = this.getRepo(userId);
    return repo.count(type);
  }

  /**
   * Boost a memory's importance (e.g. when referenced again)
   */
  async boostMemory(userId: string, id: string, amount = 0.1): Promise<Memory | null> {
    const repo = this.getRepo(userId);
    return repo.boost(id, amount);
  }

  /**
   * Decay old memories' importance over time
   */
  async decayMemories(
    userId: string,
    options: { daysThreshold?: number; decayFactor?: number } = {},
  ): Promise<number> {
    const repo = this.getRepo(userId);
    return repo.decay(options);
  }

  /**
   * Cleanup old low-importance memories.
   * Also evicts stale embedding cache entries (fire-and-forget).
   */
  async cleanupMemories(
    userId: string,
    options: { maxAge?: number; minImportance?: number } = {},
  ): Promise<number> {
    const repo = this.getRepo(userId);
    const deleted = await repo.cleanup(options);

    // Also evict stale embedding cache entries (fire-and-forget)
    import('../db/repositories/embedding-cache.js').then(({ embeddingCacheRepo }) => {
      embeddingCacheRepo.evict().catch(() => {});
    }).catch(() => {});

    return deleted;
  }
}

// ============================================================================
// Error Type
// ============================================================================

export type MemoryServiceErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR';

export class MemoryServiceError extends Error {
  constructor(
    message: string,
    public readonly code: MemoryServiceErrorCode,
  ) {
    super(message);
    this.name = 'MemoryServiceError';
  }
}

// ============================================================================
// Singleton (internal — use ServiceRegistry instead)
// ============================================================================

let instance: MemoryService | null = null;

export function getMemoryService(): MemoryService {
  if (!instance) {
    instance = new MemoryService();
  }
  return instance;
}
