/**
 * IMemoryService - Unified Memory Management Interface
 *
 * Wraps the gateway MemoryService to provide a consistent service interface.
 * All methods accept userId as first parameter for per-user isolation.
 *
 * Usage:
 *   const memory = registry.get(Services.Memory);
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
