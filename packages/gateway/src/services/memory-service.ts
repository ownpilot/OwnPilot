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

export class MemoryService {
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
    const repo = this.getRepo(userId);
    const memory = await repo.create(input);
    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'memory-service',
      { resourceType: 'memory', id: memory.id },
    ));
    return memory;
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
   * Update the embedding for an existing memory (backfill support).
   */
  async updateEmbedding(userId: string, id: string, embedding: number[]): Promise<boolean> {
    const repo = this.getRepo(userId);
    return repo.updateEmbedding(id, embedding);
  }

  async getImportantMemories(
    userId: string,
    threshold = 0.7,
    limit = 20,
  ): Promise<Memory[]> {
    const repo = this.getRepo(userId);
    return repo.getImportant(threshold, limit);
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
   * Cleanup old low-importance memories
   */
  async cleanupMemories(
    userId: string,
    options: { maxAge?: number; minImportance?: number } = {},
  ): Promise<number> {
    const repo = this.getRepo(userId);
    return repo.cleanup(options);
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
// Singleton
// ============================================================================

let instance: MemoryService | null = null;

export function getMemoryService(): MemoryService {
  if (!instance) {
    instance = new MemoryService();
  }
  return instance;
}
