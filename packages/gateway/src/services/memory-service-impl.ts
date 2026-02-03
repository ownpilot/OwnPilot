/**
 * MemoryService Implementation
 *
 * Wraps the existing MemoryService to provide IMemoryService interface.
 * Maps gateway Memory type to core MemoryEntry type.
 *
 * Usage:
 *   const memory = registry.get(Services.Memory);
 *   const entry = await memory.createMemory('user-1', { type: 'fact', content: '...' });
 */

import type {
  IMemoryService,
  ServiceMemoryEntry,
  ServiceMemoryType,
  MemoryCreateInput as CreateMemoryInput,
  MemoryUpdateInput as UpdateMemoryInput,
  MemorySearchOptions,
  MemoryServiceStats as MemoryStats,
} from '@ownpilot/core';
import { getMemoryService } from './memory-service.js';
import type { Memory, MemoryType } from '../db/repositories/memories.js';

// ============================================================================
// Type Mapping Helpers
// ============================================================================

function toMemoryEntry(m: Memory): ServiceMemoryEntry {
  return {
    id: m.id,
    userId: m.userId,
    type: m.type,
    content: m.content,
    source: m.source,
    sourceId: m.sourceId,
    importance: m.importance,
    tags: m.tags,
    accessCount: m.accessedCount,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    lastAccessedAt: m.accessedAt,
    metadata: m.metadata,
  };
}

// ============================================================================
// MemoryServiceImpl Adapter
// ============================================================================

export class MemoryServiceImpl implements IMemoryService {
  private get service() {
    return getMemoryService();
  }

  async createMemory(userId: string, input: CreateMemoryInput): Promise<ServiceMemoryEntry> {
    const result = await this.service.createMemory(userId, input);
    return toMemoryEntry(result);
  }

  async rememberMemory(
    userId: string,
    input: CreateMemoryInput,
  ): Promise<{ memory: ServiceMemoryEntry; deduplicated: boolean }> {
    const result = await this.service.rememberMemory(userId, input);
    return {
      memory: toMemoryEntry(result.memory),
      deduplicated: result.deduplicated,
    };
  }

  async batchRemember(
    userId: string,
    memories: CreateMemoryInput[],
  ): Promise<{ created: number; deduplicated: number; memories: ServiceMemoryEntry[] }> {
    const result = await this.service.batchRemember(userId, memories);
    return {
      created: result.created,
      deduplicated: result.deduplicated,
      memories: result.memories.map(toMemoryEntry),
    };
  }

  async getMemory(userId: string, id: string, incrementAccess?: boolean): Promise<ServiceMemoryEntry | null> {
    const result = await this.service.getMemory(userId, id, incrementAccess);
    return result ? toMemoryEntry(result) : null;
  }

  async updateMemory(
    userId: string,
    id: string,
    input: UpdateMemoryInput,
  ): Promise<ServiceMemoryEntry | null> {
    const result = await this.service.updateMemory(userId, id, input);
    return result ? toMemoryEntry(result) : null;
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    return this.service.deleteMemory(userId, id);
  }

  async listMemories(userId: string, query?: Record<string, unknown>): Promise<ServiceMemoryEntry[]> {
    const result = await this.service.listMemories(userId, query as Parameters<typeof this.service.listMemories>[1]);
    return result.map(toMemoryEntry);
  }

  async searchMemories(
    userId: string,
    query: string,
    options?: MemorySearchOptions,
  ): Promise<ServiceMemoryEntry[]> {
    const result = await this.service.searchMemories(userId, query, options);
    return result.map(toMemoryEntry);
  }

  async getImportantMemories(
    userId: string,
    options?: { threshold?: number; limit?: number },
  ): Promise<ServiceMemoryEntry[]> {
    const result = await this.service.getImportantMemories(
      userId,
      options?.threshold,
      options?.limit,
    );
    return result.map(toMemoryEntry);
  }

  async getRecentMemories(userId: string, limit?: number): Promise<ServiceMemoryEntry[]> {
    const result = await this.service.getRecentMemories(userId, limit);
    return result.map(toMemoryEntry);
  }

  async getStats(userId: string): Promise<MemoryStats> {
    return this.service.getStats(userId);
  }

  async boostMemory(userId: string, id: string, amount?: number): Promise<ServiceMemoryEntry | null> {
    const result = await this.service.boostMemory(userId, id, amount);
    return result ? toMemoryEntry(result) : null;
  }

  async decayMemories(
    userId: string,
    options?: { daysThreshold?: number; decayFactor?: number },
  ): Promise<number> {
    return this.service.decayMemories(userId, options);
  }

  async cleanupMemories(
    userId: string,
    options?: { maxAge?: number; minImportance?: number },
  ): Promise<number> {
    return this.service.cleanupMemories(userId, options);
  }

  async countMemories(userId: string, type?: ServiceMemoryType): Promise<number> {
    return this.service.countMemories(userId, type as MemoryType | undefined);
  }
}

/**
 * Create a new MemoryServiceImpl instance.
 */
export function createMemoryServiceImpl(): IMemoryService {
  return new MemoryServiceImpl();
}
