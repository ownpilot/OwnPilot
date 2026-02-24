/**
 * Conversation Memory System
 *
 * Barrel re-export from focused sub-modules:
 *   conversation-types:   Types, interfaces, constants
 *   conversation-store:   ConversationMemoryStore class
 *   conversation-factory: Factory functions and cache
 */

// Types & Constants
export type {
  MemoryCategory,
  MemoryImportance,
  MemorySource,
  MemoryEntry,
  ConversationSummary,
  UserProfile,
  MemoryQueryOptions,
  MemoryStats,
  MemoryRetentionPolicy,
} from './conversation-types.js';
export { DEFAULT_RETENTION_POLICY, IMPORTANCE_WEIGHTS } from './conversation-types.js';

// Store class
export { ConversationMemoryStore } from './conversation-store.js';

// Factory functions
export { createConversationMemoryStore, getMemoryStore } from './conversation-factory.js';
