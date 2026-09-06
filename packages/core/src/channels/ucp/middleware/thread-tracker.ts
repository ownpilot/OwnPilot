/**
 * UCP Thread Tracker Middleware
 *
 * Maintains unified thread IDs across channels.
 * When a message arrives in a channel with a replyToId, this middleware
 * looks up the thread that reply belongs to and attaches the threadId.
 * This enables cross-channel thread views.
 */

import type { UCPMiddleware } from './types.js';

/**
 * In-memory thread mapping.
 * Maps externalId → threadId for quick lookup.
 *
 * For production persistence, the gateway wires this to the
 * channel_messages.ucp_thread_id column.
 */
export interface ThreadStore {
  /** Get the thread ID for a message external ID. */
  getThread(externalId: string): string | undefined;

  /** Assign a message to a thread. */
  setThread(externalId: string, threadId: string): void;

  /** Generate a new unique thread ID. */
  generateThreadId(): string;
}

/** Simple in-memory thread store (default). */
export function createInMemoryThreadStore(): ThreadStore {
  const map = new Map<string, string>();
  let counter = 0;

  return {
    getThread(externalId) {
      return map.get(externalId);
    },
    setThread(externalId, threadId) {
      // Refresh recency on update: Map.set alone preserves a key's ORIGINAL
      // insertion position, so without the delete the "LRU eviction" below
      // was insertion-order eviction — it dropped the oldest-still-ACTIVE
      // thread mapping first while stale later entries survived.
      if (map.has(externalId)) map.delete(externalId);
      map.set(externalId, threadId);
      // LRU eviction — keep map bounded (iteration order == write recency)
      if (map.size > 50_000) {
        const oldest = map.keys().next().value;
        if (oldest) map.delete(oldest);
      }
    },
    generateThreadId() {
      return `thread-${Date.now()}-${++counter}`;
    },
  };
}

/**
 * Create a thread tracker middleware.
 *
 * Inbound messages:
 * - If replyToId exists, look up the parent's thread and inherit it
 * - If no thread exists, create one and assign to both parent and this message
 * - If no replyToId, create a new thread for this message
 *
 * Outbound messages:
 * - Inherit the thread from the conversation context (if present)
 */
export function threadTracker(store?: ThreadStore): UCPMiddleware {
  const _store = store ?? createInMemoryThreadStore();

  return async (msg, next) => {
    if (msg.direction === 'inbound') {
      if (msg.replyToId) {
        // Look up parent thread
        const parentThread = _store.getThread(msg.replyToId);
        if (parentThread) {
          msg = { ...msg, threadId: parentThread };
        } else {
          // New thread starting from this reply chain
          const threadId = _store.generateThreadId();
          _store.setThread(msg.replyToId, threadId);
          msg = { ...msg, threadId };
        }
      } else if (!msg.threadId) {
        // New standalone message — create thread
        const threadId = _store.generateThreadId();
        msg = { ...msg, threadId };
      }

      // Register this message in the thread
      _store.setThread(msg.externalId, msg.threadId!);
    }

    return next();
  };
}
