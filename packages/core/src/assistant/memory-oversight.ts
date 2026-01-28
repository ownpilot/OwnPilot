/**
 * Memory Oversight & Management Tools
 *
 * Provides tools for users to:
 * - View and search their memories
 * - Delete or archive specific memories
 * - Clear memories by category/date
 * - Export and backup memories
 * - Configure retention policies
 *
 * SECURITY: All operations are scoped to the current user
 */

import type { ToolDefinition, ToolExecutor, ToolContext } from '../agent/types.js';
import type {
  ConversationMemoryStore,
  MemoryEntry,
  MemoryCategory,
  MemoryImportance,
  MemoryQueryOptions,
  MemoryRetentionPolicy,
  UserProfile,
} from '../memory/conversation.js';
import { getMemoryStore, DEFAULT_RETENTION_POLICY } from '../memory/conversation.js';

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * List memories tool
 */
export const LIST_MEMORIES_TOOL: ToolDefinition = {
  name: 'list_memories',
  description: 'View your stored memories. Filter by category, importance, date range, or search text.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['fact', 'preference', 'episode', 'skill', 'instruction', 'relationship', 'goal', 'context'],
        description: 'Filter by memory category',
      },
      importance: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Filter by minimum importance level',
      },
      search: {
        type: 'string',
        description: 'Search text in memory content',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return (default: 20)',
      },
      includeArchived: {
        type: 'boolean',
        description: 'Include archived memories (default: false)',
      },
    },
  },
};

/**
 * Delete memory tool
 */
export const DELETE_MEMORY_TOOL: ToolDefinition = {
  name: 'delete_memory',
  description: 'Delete a specific memory by ID. Use list_memories first to find the memory ID.',
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The ID of the memory to delete',
      },
    },
    required: ['memoryId'],
  },
};

/**
 * Bulk delete memories tool
 */
export const BULK_DELETE_MEMORIES_TOOL: ToolDefinition = {
  name: 'bulk_delete_memories',
  description: 'Delete multiple memories based on criteria. Use with caution!',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['fact', 'preference', 'episode', 'skill', 'instruction', 'relationship', 'goal', 'context'],
        description: 'Delete all memories in this category',
      },
      olderThan: {
        type: 'string',
        description: 'Delete memories older than this date (ISO format)',
      },
      importance: {
        type: 'string',
        enum: ['low', 'medium'],
        description: 'Delete memories at or below this importance level',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to confirm deletion',
      },
    },
    required: ['confirm'],
  },
};

/**
 * Archive memory tool
 */
export const ARCHIVE_MEMORY_TOOL: ToolDefinition = {
  name: 'archive_memory',
  description: 'Archive a memory (keeps it but hides from active searches)',
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The ID of the memory to archive',
      },
    },
    required: ['memoryId'],
  },
};

/**
 * Restore archived memory tool
 */
export const RESTORE_MEMORY_TOOL: ToolDefinition = {
  name: 'restore_memory',
  description: 'Restore an archived memory back to active status',
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The ID of the archived memory to restore',
      },
    },
    required: ['memoryId'],
  },
};

/**
 * View user profile tool
 */
export const VIEW_PROFILE_TOOL: ToolDefinition = {
  name: 'view_my_profile',
  description: 'View the AI\'s understanding of you based on stored memories',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Update memory importance tool
 */
export const UPDATE_MEMORY_IMPORTANCE_TOOL: ToolDefinition = {
  name: 'update_memory_importance',
  description: 'Change the importance level of a memory',
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The ID of the memory to update',
      },
      importance: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'New importance level',
      },
    },
    required: ['memoryId', 'importance'],
  },
};

/**
 * Export memories tool
 */
export const EXPORT_MEMORIES_TOOL: ToolDefinition = {
  name: 'export_memories',
  description: 'Export your memories as JSON for backup',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['fact', 'preference', 'episode', 'skill', 'instruction', 'relationship', 'goal', 'context'],
        description: 'Export only this category (optional)',
      },
      includeArchived: {
        type: 'boolean',
        description: 'Include archived memories',
      },
    },
  },
};

/**
 * Memory statistics tool
 */
export const MEMORY_STATS_TOOL: ToolDefinition = {
  name: 'memory_stats',
  description: 'Get statistics about your stored memories',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Clear all memories tool
 */
export const CLEAR_ALL_MEMORIES_TOOL: ToolDefinition = {
  name: 'clear_all_memories',
  description: 'DANGER: Delete ALL memories. Requires double confirmation.',
  parameters: {
    type: 'object',
    properties: {
      confirm: {
        type: 'boolean',
        description: 'First confirmation',
      },
      confirmPhrase: {
        type: 'string',
        description: 'Type "DELETE ALL MY MEMORIES" to confirm',
      },
    },
    required: ['confirm', 'confirmPhrase'],
  },
};

/**
 * Configure retention policy tool
 */
export const CONFIGURE_RETENTION_TOOL: ToolDefinition = {
  name: 'configure_retention',
  description: 'Configure automatic memory cleanup rules',
  parameters: {
    type: 'object',
    properties: {
      autoArchiveDays: {
        type: 'number',
        description: 'Days before auto-archiving low-importance memories',
      },
      autoDeleteDays: {
        type: 'number',
        description: 'Days before auto-deleting archived memories',
      },
      maxMemories: {
        type: 'number',
        description: 'Maximum total memories to keep',
      },
      preserveCategories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Categories to never auto-delete',
      },
    },
  },
};

// =============================================================================
// Tool Executors
// =============================================================================

/**
 * Create memory oversight tool executors
 */
export function createMemoryOversightExecutors(
  getStore: () => ConversationMemoryStore
): Record<string, ToolExecutor> {
  return {
    list_memories: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const store = getStore();
      const args = rawArgs as {
        category?: MemoryCategory;
        importance?: MemoryImportance;
        search?: string;
        limit?: number;
        includeArchived?: boolean;
      };
      const { category, importance, search, limit = 20, includeArchived = false } = args;

      const queryOptions: MemoryQueryOptions = {
        limit,
        includeArchived,
      };

      if (category) queryOptions.category = category;
      if (importance) queryOptions.minImportance = importance;
      if (search) queryOptions.searchText = search;

      const memories = await store.queryMemories(queryOptions);

      if (memories.length === 0) {
        return {
          content: {
            success: true,
            message: 'No memories found matching your criteria.',
            memories: [],
          },
        };
      }

      const formatted = memories.map(formatMemoryForDisplay);

      return {
        content: {
          success: true,
          count: memories.length,
          memories: formatted,
        },
      };
    },

    delete_memory: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const store = getStore();
      const args = rawArgs as { memoryId: string };
      const { memoryId } = args;

      // First verify the memory exists
      const existing = await store.getMemory(memoryId);
      if (!existing) {
        return {
          content: {
            success: false,
            error: `Memory with ID ${memoryId} not found.`,
          },
        };
      }

      await store.deleteMemory(memoryId);

      return {
        content: {
          success: true,
          message: `Deleted memory: "${existing.content.substring(0, 50)}..."`,
          deletedMemory: formatMemoryForDisplay(existing),
        },
      };
    },

    bulk_delete_memories: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const args = rawArgs as {
        category?: MemoryCategory;
        olderThan?: string;
        importance?: MemoryImportance;
        confirm: boolean;
      };
      if (!args.confirm) {
        return {
          content: {
            success: false,
            error: 'You must set confirm: true to delete memories.',
          },
        };
      }

      const store = getStore();
      const { category, olderThan, importance } = args;

      // Build query to find memories to delete
      const queryOptions: MemoryQueryOptions = {
        limit: 1000, // Reasonable batch size
        includeArchived: true,
      };

      if (category) queryOptions.category = category;
      if (importance) queryOptions.minImportance = importance;

      const memories = await store.queryMemories(queryOptions);

      let toDelete = memories;

      // Filter by date if specified
      if (olderThan) {
        const cutoffDate = new Date(olderThan);
        toDelete = memories.filter(m => new Date(m.createdAt) < cutoffDate);
      }

      // Filter by importance (at or below specified level)
      if (importance) {
        const importanceLevels: MemoryImportance[] = ['low', 'medium', 'high', 'critical'];
        const maxIndex = importanceLevels.indexOf(importance);
        toDelete = toDelete.filter(m => importanceLevels.indexOf(m.importance) <= maxIndex);
      }

      // Delete all matching memories
      let deleted = 0;
      for (const memory of toDelete) {
        await store.deleteMemory(memory.id);
        deleted++;
      }

      return {
        content: {
          success: true,
          message: `Deleted ${deleted} memories.`,
          criteria: { category, olderThan, importance },
        },
      };
    },

    archive_memory: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const store = getStore();
      const args = rawArgs as { memoryId: string };
      const { memoryId } = args;

      const existing = await store.getMemory(memoryId);
      if (!existing) {
        return {
          content: {
            success: false,
            error: `Memory with ID ${memoryId} not found.`,
          },
        };
      }

      if (existing.archived) {
        return {
          content: {
            success: false,
            error: 'Memory is already archived.',
          },
        };
      }

      await store.archiveMemory(memoryId);

      return {
        content: {
          success: true,
          message: `Archived memory: "${existing.content.substring(0, 50)}..."`,
        },
      };
    },

    restore_memory: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const store = getStore();
      const args = rawArgs as { memoryId: string };
      const { memoryId } = args;

      const existing = await store.getMemory(memoryId);
      if (!existing) {
        return {
          content: {
            success: false,
            error: `Memory with ID ${memoryId} not found.`,
          },
        };
      }

      if (!existing.archived) {
        return {
          content: {
            success: false,
            error: 'Memory is not archived.',
          },
        };
      }

      await store.restoreMemory(memoryId);

      return {
        content: {
          success: true,
          message: `Restored memory: "${existing.content.substring(0, 50)}..."`,
        },
      };
    },

    view_my_profile: async (
      _rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const store = getStore();
      const profile = await store.getUserProfile();

      return {
        content: {
          success: true,
          profile: {
            ...profile,
            summary: formatProfileSummary(profile),
          },
        },
      };
    },

    update_memory_importance: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const store = getStore();
      const args = rawArgs as { memoryId: string; importance: MemoryImportance };
      const { memoryId, importance } = args;

      const existing = await store.getMemory(memoryId);
      if (!existing) {
        return {
          content: {
            success: false,
            error: `Memory with ID ${memoryId} not found.`,
          },
        };
      }

      await store.updateMemory(memoryId, { importance });

      return {
        content: {
          success: true,
          message: `Updated memory importance from ${existing.importance} to ${importance}`,
        },
      };
    },

    export_memories: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const store = getStore();
      const args = rawArgs as { category?: MemoryCategory; includeArchived?: boolean };
      const { category, includeArchived = false } = args;

      const queryOptions: MemoryQueryOptions = {
        limit: 10000, // Export all
        includeArchived,
      };

      if (category) queryOptions.category = category;

      const memories = await store.queryMemories(queryOptions);
      const profile = await store.getUserProfile();

      const exportData = {
        exportedAt: new Date().toISOString(),
        userId: store.getUserId(),
        memoryCount: memories.length,
        profile,
        memories: memories.map(m => ({
          id: m.id,
          content: m.content,
          category: m.category,
          importance: m.importance,
          tags: m.tags,
          source: m.source,
          createdAt: m.createdAt,
          archived: m.archived,
        })),
      };

      return {
        content: {
          success: true,
          message: `Exported ${memories.length} memories.`,
          exportData,
        },
      };
    },

    memory_stats: async (
      _rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const store = getStore();

      // Get all memories for stats
      const allMemories = await store.queryMemories({ limit: 10000, includeArchived: true });

      // Calculate statistics
      const stats = {
        total: allMemories.length,
        active: allMemories.filter(m => !m.archived).length,
        archived: allMemories.filter(m => m.archived).length,
        byCategory: {} as Record<string, number>,
        byImportance: {} as Record<string, number>,
        oldestMemory: null as string | null,
        newestMemory: null as string | null,
        totalAccessCount: 0,
      };

      for (const memory of allMemories) {
        // By category
        stats.byCategory[memory.category] = (stats.byCategory[memory.category] || 0) + 1;

        // By importance
        stats.byImportance[memory.importance] = (stats.byImportance[memory.importance] || 0) + 1;

        // Access count
        stats.totalAccessCount += memory.accessCount;
      }

      // Find oldest and newest
      if (allMemories.length > 0) {
        const sorted = [...allMemories].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        stats.oldestMemory = sorted[0]!.createdAt;
        stats.newestMemory = sorted[sorted.length - 1]!.createdAt;
      }

      return {
        content: {
          success: true,
          stats,
        },
      };
    },

    clear_all_memories: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const args = rawArgs as { confirm: boolean; confirmPhrase: string };
      const { confirm, confirmPhrase } = args;

      if (!confirm) {
        return {
          content: {
            success: false,
            error: 'You must set confirm: true.',
          },
        };
      }

      if (confirmPhrase !== 'DELETE ALL MY MEMORIES') {
        return {
          content: {
            success: false,
            error: 'Confirmation phrase must be exactly: "DELETE ALL MY MEMORIES"',
          },
        };
      }

      const store = getStore();
      const allMemories = await store.queryMemories({ limit: 10000, includeArchived: true });

      let deleted = 0;
      for (const memory of allMemories) {
        await store.deleteMemory(memory.id);
        deleted++;
      }

      return {
        content: {
          success: true,
          message: `Deleted ALL ${deleted} memories. Starting fresh.`,
          warning: 'This action cannot be undone.',
        },
      };
    },

    configure_retention: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const store = getStore();
      const args = rawArgs as {
        autoArchiveDays?: number;
        autoDeleteDays?: number;
        maxMemories?: number;
        preserveCategories?: string[];
      };

      // Build new policy from args
      // Note: autoDeleteDays maps to deleteArchivedAfterDays, preserveCategories maps to exemptCategories
      const newPolicy: MemoryRetentionPolicy = {
        ...DEFAULT_RETENTION_POLICY,
        ...(args.autoArchiveDays !== undefined && { autoArchiveDays: args.autoArchiveDays }),
        ...(args.autoDeleteDays !== undefined && { deleteArchivedAfterDays: args.autoDeleteDays }),
        ...(args.maxMemories !== undefined && { maxMemories: args.maxMemories }),
        ...(args.preserveCategories !== undefined && {
          exemptCategories: args.preserveCategories as MemoryCategory[],
        }),
      };

      store.setRetentionPolicy(newPolicy);

      return {
        content: {
          success: true,
          message: 'Retention policy updated.',
          newPolicy,
        },
      };
    },
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format memory for display
 */
function formatMemoryForDisplay(memory: MemoryEntry): Record<string, unknown> {
  return {
    id: memory.id,
    content: memory.content,
    category: memory.category,
    importance: memory.importance,
    tags: memory.tags,
    source: memory.source,
    createdAt: memory.createdAt,
    accessCount: memory.accessCount,
    archived: memory.archived,
    preview: memory.content.length > 100
      ? memory.content.substring(0, 100) + '...'
      : memory.content,
  };
}

/**
 * Format user profile summary
 */
function formatProfileSummary(profile: UserProfile): string {
  const parts: string[] = [];

  // Basic info
  if (profile.name) {
    parts.push(`Name: ${profile.name}`);
  }

  // Preferences
  if (profile.preferences.length > 0) {
    parts.push(`Preferences: ${profile.preferences.slice(0, 5).join(', ')}`);
  }

  // Facts
  if (profile.facts.length > 0) {
    parts.push(`Known facts: ${profile.facts.length}`);
  }

  // Goals
  if (profile.goals.length > 0) {
    parts.push(`Active goals: ${profile.goals.join(', ')}`);
  }

  // Relationships
  if (profile.relationships.length > 0) {
    parts.push(`Known people: ${profile.relationships.slice(0, 5).join(', ')}`);
  }

  // Topics of interest
  if (profile.topicsOfInterest.length > 0) {
    parts.push(`Interests: ${profile.topicsOfInterest.slice(0, 5).join(', ')}`);
  }

  // Communication style
  if (profile.communicationStyle) {
    const style = profile.communicationStyle;
    const styleDesc: string[] = [];
    if (style.formality) styleDesc.push(style.formality);
    if (style.verbosity) styleDesc.push(style.verbosity);
    if (style.language) styleDesc.push(`speaks ${style.language}`);
    if (styleDesc.length > 0) {
      parts.push(`Communication: ${styleDesc.join(', ')}`);
    }
  }

  return parts.join('\n');
}

// =============================================================================
// Tool Collection
// =============================================================================

/**
 * All memory oversight tools
 */
export const MEMORY_OVERSIGHT_TOOLS: ToolDefinition[] = [
  LIST_MEMORIES_TOOL,
  DELETE_MEMORY_TOOL,
  BULK_DELETE_MEMORIES_TOOL,
  ARCHIVE_MEMORY_TOOL,
  RESTORE_MEMORY_TOOL,
  VIEW_PROFILE_TOOL,
  UPDATE_MEMORY_IMPORTANCE_TOOL,
  EXPORT_MEMORIES_TOOL,
  MEMORY_STATS_TOOL,
  CLEAR_ALL_MEMORIES_TOOL,
  CONFIGURE_RETENTION_TOOL,
];

/**
 * Create all memory oversight tools with a store factory
 */
export function createMemoryOversightTools(
  getStore: () => ConversationMemoryStore
): Array<{ definition: ToolDefinition; executor: ToolExecutor }> {
  const executors = createMemoryOversightExecutors(getStore);

  return MEMORY_OVERSIGHT_TOOLS.map(definition => ({
    definition,
    executor: executors[definition.name]!,
  }));
}

// =============================================================================
// Memory Cleaner
// =============================================================================

/**
 * Memory cleaner for automated maintenance
 */
export class MemoryCleaner {
  private store: ConversationMemoryStore;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(store: ConversationMemoryStore) {
    this.store = store;
  }

  /**
   * Start automatic cleanup
   */
  startAutoCleanup(intervalMs: number = 24 * 60 * 60 * 1000): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Run immediately
    this.runCleanup().catch(console.error);

    // Then run periodically
    this.cleanupInterval = setInterval(() => {
      this.runCleanup().catch(console.error);
    }, intervalMs);
  }

  /**
   * Stop automatic cleanup
   */
  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Run cleanup based on retention policy
   */
  async runCleanup(): Promise<{ archived: number; deleted: number }> {
    return this.store.applyRetentionPolicy();
  }

  /**
   * Clean up duplicate memories
   */
  async deduplicateMemories(): Promise<number> {
    const allMemories = await this.store.queryMemories({ limit: 10000 });

    // Group by content hash
    const contentMap = new Map<string, MemoryEntry[]>();
    for (const memory of allMemories) {
      const key = memory.content.toLowerCase().trim();
      const existing = contentMap.get(key) || [];
      existing.push(memory);
      contentMap.set(key, existing);
    }

    // Find and remove duplicates
    let removed = 0;
    for (const [, memories] of contentMap) {
      if (memories.length > 1) {
        // Keep the one with highest importance or most recent
        const sorted = memories.sort((a, b) => {
          const importanceOrder: MemoryImportance[] = ['critical', 'high', 'medium', 'low'];
          const importanceDiff = importanceOrder.indexOf(a.importance) - importanceOrder.indexOf(b.importance);
          if (importanceDiff !== 0) return importanceDiff;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        // Delete all but the first (best) one
        for (let i = 1; i < sorted.length; i++) {
          await this.store.deleteMemory(sorted[i]!.id);
          removed++;
        }
      }
    }

    return removed;
  }

  /**
   * Merge similar memories
   */
  async mergeSimilarMemories(similarityThreshold: number = 0.9): Promise<number> {
    // This would use embeddings for similarity in production
    // For now, just use simple text matching
    const allMemories = await this.store.queryMemories({ limit: 10000 });
    let merged = 0;

    // Simple prefix matching for now
    const processed = new Set<string>();

    for (const memory of allMemories) {
      if (processed.has(memory.id)) continue;

      const similar = allMemories.filter(
        m =>
          !processed.has(m.id) &&
          m.id !== memory.id &&
          m.category === memory.category &&
          (m.content.startsWith(memory.content.substring(0, 50)) ||
            memory.content.startsWith(m.content.substring(0, 50)))
      );

      if (similar.length > 0) {
        // Merge into the highest importance one
        const allRelated = [memory, ...similar].sort((a, b) => {
          const importanceOrder: MemoryImportance[] = ['critical', 'high', 'medium', 'low'];
          return importanceOrder.indexOf(a.importance) - importanceOrder.indexOf(b.importance);
        });

        const primary = allRelated[0]!;

        // Combine tags from all memories
        const allTags = new Set<string>();
        for (const m of allRelated) {
          for (const tag of m.tags) allTags.add(tag);
        }

        // Update primary with combined tags
        await this.store.updateMemory(primary.id, {
          tags: Array.from(allTags),
        });

        // Delete others
        for (let i = 1; i < allRelated.length; i++) {
          await this.store.deleteMemory(allRelated[i]!.id);
          processed.add(allRelated[i]!.id);
          merged++;
        }

        processed.add(primary.id);
      }
    }

    return merged;
  }
}

/**
 * Create a memory cleaner
 */
export function createMemoryCleaner(store: ConversationMemoryStore): MemoryCleaner {
  return new MemoryCleaner(store);
}
