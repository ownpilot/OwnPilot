/**
 * Event System - Base Types
 *
 * Shared type definitions for the unified event and hook system.
 */

// ============================================================================
// Event Categories
// ============================================================================

/**
 * Top-level event categories.
 * The category is auto-derived from the first segment of the event type string.
 * e.g. 'agent.complete' → category 'agent'
 */
export type EventCategory =
  | 'agent'
  | 'tool'
  | 'resource'
  | 'plugin'
  | 'system'
  | 'channel'
  | 'gateway';

// ============================================================================
// Event Types
// ============================================================================

/**
 * A typed event envelope. Every event flowing through the bus
 * is wrapped in this structure.
 */
export interface TypedEvent<T = unknown> {
  /** Dot-delimited event type, e.g. 'agent.complete', 'channel.message.received' */
  readonly type: string;
  /** Top-level category derived from the first segment */
  readonly category: EventCategory;
  /** ISO-8601 timestamp */
  readonly timestamp: string;
  /** Who emitted: 'orchestrator', 'plugin:reminder', 'gateway', etc. */
  readonly source: string;
  /** Event-specific payload */
  readonly data: T;
}

/**
 * Fire-and-forget event handler.
 * Async handlers are allowed but errors are caught and logged, never propagated.
 */
export type EventHandler<T = unknown> = (event: TypedEvent<T>) => void | Promise<void>;

/**
 * Unsubscribe function returned by all subscription methods.
 */
export type Unsubscribe = () => void;

// ============================================================================
// Hook Types
// ============================================================================

/**
 * Hook context passed to hook handlers.
 * Unlike events, hook contexts are mutable - handlers can modify data
 * and signal cancellation.
 */
export interface HookContext<T = unknown> {
  /** The hook type identifier (colon-delimited, e.g. 'tool:before-execute') */
  readonly type: string;
  /** Mutable payload - handlers can modify this */
  data: T;
  /** Set to true to cancel/abort the operation */
  cancelled: boolean;
  /** Optional metadata for cross-handler communication */
  metadata: Record<string, unknown>;
}

/**
 * Hook handler - called sequentially, can modify context.
 * Returning a promise is supported (handlers are awaited in order).
 */
export type HookHandler<T = unknown> = (context: HookContext<T>) => void | Promise<void>;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract the category (first segment) from a dot-delimited event type string.
 * e.g. 'agent.complete' → 'agent', 'channel.message.received' → 'channel'
 */
export type CategoryOf<T extends string> = T extends `${infer Cat}.${string}` ? Cat : never;

/**
 * Derive EventCategory from the first segment of a dot-delimited string.
 * Returns the segment if it's a valid EventCategory, otherwise 'system' as fallback.
 */
export function deriveCategory(type: string): EventCategory {
  const firstSegment = type.split('.')[0];
  const validCategories: EventCategory[] = [
    'agent', 'tool', 'resource', 'plugin', 'system', 'channel', 'gateway',
  ];
  if (validCategories.includes(firstSegment as EventCategory)) {
    return firstSegment as EventCategory;
  }
  return 'system';
}
