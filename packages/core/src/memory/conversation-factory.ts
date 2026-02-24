/**
 * Conversation Memory Factory Functions
 *
 * Creation helpers and singleton cache for ConversationMemoryStore.
 */

import type { MemoryRetentionPolicy } from './conversation-types.js';
import { ConversationMemoryStore } from './conversation-store.js';

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a conversation memory store
 */
export function createConversationMemoryStore(
  userId: string,
  options?: {
    storageDir?: string;
    retentionPolicy?: Partial<MemoryRetentionPolicy>;
  }
): ConversationMemoryStore {
  return new ConversationMemoryStore(userId, options);
}

/**
 * Memory store cache (one per user)
 */
const memoryStoreCache = new Map<string, ConversationMemoryStore>();

/**
 * Get or create memory store for a user
 */
export async function getMemoryStore(userId: string): Promise<ConversationMemoryStore> {
  let store = memoryStoreCache.get(userId);
  if (!store) {
    store = createConversationMemoryStore(userId);
    await store.initialize();
    memoryStoreCache.set(userId, store);
  }
  return store;
}
