/**
 * Chat shared state — module-level state used by chat.ts and chat-history.ts.
 *
 * Extracted from chat.ts to break the circular dependency:
 *   chat.ts → chat-history.ts → chat.ts
 * Now: chat-history.ts → chat-state.ts (leaf, no cycle)
 */

import type { ExecutionPermissions } from '@ownpilot/core';

/** Add value to a Set, evicting the oldest entry when at capacity (insertion-order LRU). */
export function boundedSetAdd<T>(set: Set<T>, value: T, maxSize: number): void {
  if (set.size >= maxSize) {
    set.delete(set.values().next().value!);
  }
  set.add(value);
}

/** Add key-value pair to a Map, evicting the oldest entry when at capacity. */
export function boundedMapSet<K, V>(map: Map<K, V>, key: K, value: V, maxSize: number): void {
  if (!map.has(key) && map.size >= maxSize) {
    map.delete(map.keys().next().value!);
  }
  map.set(key, value);
}

/**
 * Tracks which conversation IDs have had their system prompt fully initialized
 * (workspace, execution, tool catalog). Skip redundant rebuilds on subsequent messages.
 * Cleared on new session / agent cache eviction.
 */
export const promptInitializedConversations = new Set<string>();

/** Last execution permissions hash per user, to detect changes between messages */
export const lastExecPermHash = new Map<string, string>();

export function execPermHash(perms: ExecutionPermissions): string {
  return `${perms.enabled}|${perms.mode}|${perms.execute_javascript}|${perms.execute_python}|${perms.execute_shell}|${perms.compile_code}|${perms.package_manager}`;
}
