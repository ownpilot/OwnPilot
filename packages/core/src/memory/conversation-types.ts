/**
 * Conversation Memory Types & Constants
 *
 * Type definitions and default values for the conversation memory system.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Memory categories
 */
export type MemoryCategory =
  | 'fact' // Specific facts about user (name, job, family)
  | 'preference' // User preferences and tastes
  | 'episode' // Conversation summaries
  | 'skill' // Learned skills/capabilities
  | 'instruction' // Custom instructions from user
  | 'relationship' // How user relates to people/things
  | 'goal' // User's goals and aspirations
  | 'context'; // Contextual information

/**
 * Memory importance level
 */
export type MemoryImportance = 'critical' | 'high' | 'medium' | 'low';

/**
 * Memory source
 */
export type MemorySource =
  | 'user_stated' // User explicitly said this
  | 'user_confirmed' // AI inferred and user confirmed
  | 'ai_inferred' // AI inferred from conversation
  | 'system_generated' // System generated (e.g., summaries)
  | 'imported'; // Imported from external source

/**
 * Memory entry
 */
export interface MemoryEntry {
  /** Unique memory ID */
  id: string;
  /** User ID who owns this memory */
  userId: string;
  /** Memory category */
  category: MemoryCategory;
  /** Memory content */
  content: string;
  /** Structured data (optional) */
  data?: Record<string, unknown>;
  /** Importance level */
  importance: MemoryImportance;
  /** Source of this memory */
  source: MemorySource;
  /** Confidence score (0-1) */
  confidence: number;
  /** Tags for retrieval */
  tags: string[];
  /** Related memory IDs */
  relatedMemories?: string[];
  /** Number of times this memory was accessed */
  accessCount: number;
  /** Last accessed timestamp */
  lastAccessed?: string;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Expiry date (optional) */
  expiresAt?: string;
  /** Whether memory is archived */
  archived: boolean;
  /** Conversation ID where this was learned (for episodes) */
  conversationId?: string;
}

/**
 * Conversation summary
 */
export interface ConversationSummary {
  /** Conversation ID */
  conversationId: string;
  /** User ID */
  userId: string;
  /** Summary text */
  summary: string;
  /** Key topics discussed */
  topics: string[];
  /** Facts learned in this conversation */
  factsLearned: string[];
  /** Actions taken */
  actionsTaken: string[];
  /** User sentiment */
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  /** Message count */
  messageCount: number;
  /** Duration in minutes */
  durationMinutes: number;
  /** Start time */
  startedAt: string;
  /** End time */
  endedAt: string;
  /** Created timestamp */
  createdAt: string;
}

/**
 * User profile (aggregated from memories)
 */
export interface UserProfile {
  /** User ID */
  userId: string;
  /** Display name (if known) */
  name?: string;
  /** Key facts about the user */
  facts: Array<{ key: string; value: string; confidence: number }>;
  /** User preferences */
  preferences: string[];
  /** Detailed preferences with metadata */
  preferencesDetailed?: Array<{ category: string; preference: string; strength: number }>;
  /** Communication style */
  communicationStyle?: {
    formality: 'formal' | 'casual' | 'mixed';
    verbosity: 'concise' | 'detailed' | 'mixed';
    language?: string;
    timezone?: string;
  };
  /** Interests and topics */
  interests: string[];
  /** Topics of interest (alias for interests) */
  topicsOfInterest: string[];
  /** Goals */
  goals: string[];
  /** Known relationships (people, organizations) */
  relationships: string[];
  /** Custom instructions */
  customInstructions: string[];
  /** Last interaction */
  lastInteraction: string;
  /** Total conversations */
  totalConversations: number;
  /** Profile completeness (0-100) */
  completeness: number;
}

/**
 * Memory query options
 */
export interface MemoryQueryOptions {
  /** Filter by single category */
  category?: MemoryCategory;
  /** Filter by categories */
  categories?: MemoryCategory[];
  /** Filter by importance */
  minImportance?: MemoryImportance;
  /** Filter by tags */
  tags?: string[];
  /** Filter by confidence */
  minConfidence?: number;
  /** Include archived */
  includeArchived?: boolean;
  /** Limit results */
  limit?: number;
  /** Sort by */
  sortBy?: 'relevance' | 'recency' | 'importance' | 'access_count';
  /** Search query */
  query?: string;
  /** Search text (alias for query) */
  searchText?: string;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  /** Total memories */
  totalMemories: number;
  /** By category */
  byCategory: Record<MemoryCategory, number>;
  /** By importance */
  byImportance: Record<MemoryImportance, number>;
  /** By source */
  bySource: Record<MemorySource, number>;
  /** Archived count */
  archivedCount: number;
  /** Total conversations summarized */
  totalConversations: number;
  /** Storage size (bytes) */
  storageBytes: number;
  /** Oldest memory */
  oldestMemory?: string;
  /** Newest memory */
  newestMemory?: string;
}

/**
 * Memory retention policy
 */
export interface MemoryRetentionPolicy {
  /** Max memories to keep */
  maxMemories: number;
  /** Max age for low importance memories (days) */
  lowImportanceMaxAgeDays: number;
  /** Max age for medium importance memories (days) */
  mediumImportanceMaxAgeDays: number;
  /** Auto-archive threshold (days since last access) */
  autoArchiveDays: number;
  /** Auto-delete archived after (days) */
  deleteArchivedAfterDays: number;
  /** Categories exempt from auto-cleanup */
  exemptCategories: MemoryCategory[];
}

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default retention policy
 */
export const DEFAULT_RETENTION_POLICY: MemoryRetentionPolicy = {
  maxMemories: 10000,
  lowImportanceMaxAgeDays: 90,
  mediumImportanceMaxAgeDays: 365,
  autoArchiveDays: 180,
  deleteArchivedAfterDays: 365,
  exemptCategories: ['fact', 'instruction', 'goal'],
};

/**
 * Importance score weights
 */
export const IMPORTANCE_WEIGHTS: Record<MemoryImportance, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};
