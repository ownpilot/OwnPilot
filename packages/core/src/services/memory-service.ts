/**
 * IMemoryService - Unified Memory Management Interface
 *
 * Wraps the gateway MemoryService to provide a consistent service interface.
 * All methods accept userId as first parameter for per-user isolation.
 *
 * Usage:
 *   const memory = getMemoryService();
 *   const entry = await memory.createMemory('user-1', { type: 'fact', content: '...' });
 */

// ============================================================================
// Memory Types
// ============================================================================

export type MemoryType = 'fact' | 'preference' | 'conversation' | 'event' | 'skill';

export interface ServiceMemoryEntry {
  readonly id: string;
  readonly userId: string;
  readonly type: MemoryType;
  readonly content: string;
  readonly source?: string;
  readonly sourceId?: string;
  readonly importance: number;
  readonly tags: string[];
  readonly accessCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastAccessedAt?: Date;
  readonly metadata: Record<string, unknown>;
}

export interface CreateMemoryInput {
  readonly type: MemoryType;
  readonly content: string;
  readonly source?: string;
  readonly sourceId?: string;
  readonly importance?: number;
  readonly tags?: string[];
  readonly embedding?: number[];
  readonly metadata?: Record<string, unknown>;
}

export interface UpdateMemoryInput {
  readonly content?: string;
  readonly importance?: number;
  readonly tags?: string[];
  readonly metadata?: Record<string, unknown>;
}

export interface MemorySearchOptions {
  readonly type?: MemoryType;
  readonly limit?: number;
}

export interface MemoryStats {
  readonly total: number;
  readonly byType: Record<MemoryType, number>;
  readonly avgImportance: number;
  readonly recentCount: number;
}

// ============================================================================
// IMemoryService
// ============================================================================

export interface IMemoryService {
  /**
   * Create a new memory entry.
   */
  createMemory(userId: string, input: CreateMemoryInput): Promise<ServiceMemoryEntry>;

  /**
   * Remember with deduplication - creates or updates if similar exists.
   */
  rememberMemory(
    userId: string,
    input: CreateMemoryInput
  ): Promise<{ memory: ServiceMemoryEntry; deduplicated: boolean }>;

  /**
   * Batch remember with deduplication.
   */
  batchRemember(
    userId: string,
    memories: CreateMemoryInput[]
  ): Promise<{ created: number; deduplicated: number; memories: ServiceMemoryEntry[] }>;

  /**
   * Get a memory by ID.
   * @param incrementAccess - Whether to track access (default true).
   */
  getMemory(
    userId: string,
    id: string,
    incrementAccess?: boolean
  ): Promise<ServiceMemoryEntry | null>;

  /**
   * Update a memory.
   */
  updateMemory(
    userId: string,
    id: string,
    input: UpdateMemoryInput
  ): Promise<ServiceMemoryEntry | null>;

  /**
   * Delete a memory.
   */
  deleteMemory(userId: string, id: string): Promise<boolean>;

  /**
   * List memories with optional query filters.
   */
  listMemories(userId: string, query?: Record<string, unknown>): Promise<ServiceMemoryEntry[]>;

  /**
   * Search memories by text query.
   */
  searchMemories(
    userId: string,
    query: string,
    options?: MemorySearchOptions
  ): Promise<ServiceMemoryEntry[]>;

  /**
   * Get important memories above threshold.
   */
  getImportantMemories(
    userId: string,
    options?: { threshold?: number; limit?: number }
  ): Promise<ServiceMemoryEntry[]>;

  /**
   * Get most recent memories.
   */
  getRecentMemories(userId: string, limit?: number): Promise<ServiceMemoryEntry[]>;

  /**
   * Get memory statistics.
   */
  getStats(userId: string): Promise<MemoryStats>;

  /**
   * Boost a memory's importance.
   */
  boostMemory(userId: string, id: string, amount?: number): Promise<ServiceMemoryEntry | null>;

  /**
   * Decay old memories' importance.
   */
  decayMemories(
    userId: string,
    options?: { daysThreshold?: number; decayFactor?: number }
  ): Promise<number>;

  /**
   * Clean up old/low-importance memories.
   */
  cleanupMemories(
    userId: string,
    options?: { maxAge?: number; minImportance?: number }
  ): Promise<number>;

  /**
   * Count total memories for user, optionally filtered by type.
   */
  countMemories(userId: string, type?: MemoryType): Promise<number>;

  /**
   * Hybrid search: vector + FTS + RRF ranking.
   * Generates query embedding on-the-fly, falls back to FTS/keyword if unavailable.
   */
  hybridSearch(
    userId: string,
    query: string,
    options?: MemorySearchOptions & { minImportance?: number }
  ): Promise<Array<ServiceMemoryEntry & { score: number; matchType: string }>>;
}

// ============================================================================
// Singleton access — matches the LLMRouter / ChannelService / ConfigCenter /
// PermissionGate pattern. Memory is the 6th horizontal capability promoted to
// core; runtimes consume it through `ctx.memory.*` instead of reaching into
// the registry directly.
// ============================================================================

import { hasServiceRegistry, getServiceRegistry } from './registry.js';
import { ServiceToken } from './registry.js';

/**
 * Service registry token for the MemoryService. The same token is mirrored
 * from `Services.Memory` in tokens.ts so callers can pick either entry
 * point.
 */
export const MemoryToken = new ServiceToken<IMemoryService>('memory');

let _memoryService: IMemoryService | null = null;

/**
 * Register the MemoryService implementation. Called once at gateway
 * startup. Also mirrors into the service registry so legacy callers that
 * resolve through `Services.Memory` still work.
 */
export function setMemoryService(service: IMemoryService): void {
  _memoryService = service;

  if (hasServiceRegistry()) {
    try {
      const registry = getServiceRegistry();
      if (!registry.has(MemoryToken)) {
        registry.register(MemoryToken, service);
      }
    } catch {
      // Registry not ready
    }
  }
}

/**
 * Get the MemoryService. Tries the service registry first, falls back to
 * the direct singleton. Throws if neither is initialized.
 */
export function getMemoryService(): IMemoryService {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(MemoryToken);
    } catch {
      // Not registered yet — fall through to direct singleton
    }
  }

  if (!_memoryService) {
    throw new Error(
      'MemoryService not initialized. Call setMemoryService() during gateway startup.'
    );
  }
  return _memoryService;
}

/** Check whether the MemoryService has been initialized. */
export function hasMemoryService(): boolean {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().has(MemoryToken);
    } catch {
      // fall through
    }
  }
  return _memoryService !== null;
}
