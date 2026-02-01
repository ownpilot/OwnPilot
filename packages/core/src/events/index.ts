/**
 * EventBus - Unified Typed Event System
 *
 * A single event bus that replaces both the AgentOrchestrator EventEmitter
 * and the PluginRegistry custom pub/sub. Provides typed events, wildcard
 * subscriptions, and async handler support.
 */

// ============================================================================
// Event Categories & Base Types
// ============================================================================

export type EventCategory = 'tool' | 'resource' | 'plugin' | 'agent' | 'system';

export interface TypedEvent<T = unknown> {
  /** Dot-delimited event type, e.g. 'agent.complete', 'resource.created' */
  type: string;
  /** Top-level category for wildcard subscriptions */
  category: EventCategory;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Who emitted: 'orchestrator', 'plugin:reminder', 'goal-service', etc. */
  source: string;
  /** Event-specific payload */
  data: T;
}

// ============================================================================
// Concrete Event Data Types
// ============================================================================

// --- Agent events (bridge from AgentOrchestrator EventEmitter) ---

export interface AgentIterationData {
  agentId: string;
  iteration: number;
}

export interface AgentCompleteData {
  agentId: string;
  response?: string;
  iterationCount: number;
  duration: number;
}

export interface AgentErrorData {
  agentId: string;
  error: string;
  iteration: number;
}

export interface AgentToolCallData {
  agentId: string;
  toolName: string;
  args: unknown;
  duration: number;
  success: boolean;
  error?: string;
}

export interface AgentStepData {
  agentId: string;
  stepType: string;
  content: unknown;
}

// --- Tool events ---

import type { ToolSource } from '../agent/types.js';

export type { ToolSource };

export interface ToolRegisteredData {
  name: string;
  source: ToolSource;
  pluginId?: string;
}

export interface ToolUnregisteredData {
  name: string;
}

export interface ToolExecutedData {
  name: string;
  duration: number;
  success: boolean;
  error?: string;
  conversationId?: string;
}

// --- Resource events (generic CRUD for any repository) ---

export interface ResourceCreatedData {
  resourceType: string;
  id: string;
  data?: unknown;
}

export interface ResourceUpdatedData {
  resourceType: string;
  id: string;
  changes?: unknown;
}

export interface ResourceDeletedData {
  resourceType: string;
  id: string;
}

// --- Plugin events ---

export interface PluginStatusData {
  pluginId: string;
  oldStatus: string;
  newStatus: string;
}

export interface PluginCustomData {
  pluginId: string;
  event: string;
  data: unknown;
}

// --- System events ---

export interface SystemStartupData {
  version: string;
}

export interface SystemShutdownData {
  reason?: string;
}

// ============================================================================
// Event Type Constants
// ============================================================================

export const EventTypes = {
  // Agent
  AGENT_ITERATION: 'agent.iteration',
  AGENT_COMPLETE: 'agent.complete',
  AGENT_ERROR: 'agent.error',
  AGENT_TOOL_CALL: 'agent.tool_call',
  AGENT_STEP: 'agent.step',

  // Tool
  TOOL_REGISTERED: 'tool.registered',
  TOOL_UNREGISTERED: 'tool.unregistered',
  TOOL_EXECUTED: 'tool.executed',

  // Resource
  RESOURCE_CREATED: 'resource.created',
  RESOURCE_UPDATED: 'resource.updated',
  RESOURCE_DELETED: 'resource.deleted',

  // Plugin
  PLUGIN_STATUS: 'plugin.status',
  PLUGIN_CUSTOM: 'plugin.custom',

  // System
  SYSTEM_STARTUP: 'system.startup',
  SYSTEM_SHUTDOWN: 'system.shutdown',
} as const;

// ============================================================================
// IEventBus Interface
// ============================================================================

export type EventHandler<T = unknown> = (event: TypedEvent<T>) => void | Promise<void>;

export interface IEventBus {
  /** Emit a typed event to all matching subscribers */
  emit<T>(event: TypedEvent<T>): void;

  /** Subscribe to a specific event type. Returns an unsubscribe function. */
  on<T = unknown>(type: string, handler: EventHandler<T>): () => void;

  /** Unsubscribe a handler from a specific event type */
  off(type: string, handler: EventHandler): void;

  /**
   * Subscribe to all events in a category (e.g. 'agent', 'tool').
   * Returns an unsubscribe function.
   */
  onCategory(category: EventCategory, handler: EventHandler): () => void;

  /**
   * Subscribe using a wildcard pattern (e.g. 'agent.*', 'resource.*').
   * The '*' matches any single segment, '**' matches any depth.
   * Returns an unsubscribe function.
   */
  onPattern(pattern: string, handler: EventHandler): () => void;

  /** Remove all handlers (for testing/cleanup) */
  clear(): void;
}

// ============================================================================
// EventBus Implementation
// ============================================================================

export class EventBus implements IEventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private categoryHandlers = new Map<EventCategory, Set<EventHandler>>();
  private patternHandlers = new Map<string, Set<EventHandler>>();

  emit<T>(event: TypedEvent<T>): void {
    // 1. Exact type match
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        this.safeCall(handler, event);
      }
    }

    // 2. Category match
    const catHandlers = this.categoryHandlers.get(event.category);
    if (catHandlers) {
      for (const handler of catHandlers) {
        this.safeCall(handler, event);
      }
    }

    // 3. Pattern match
    for (const [pattern, patHandlers] of this.patternHandlers) {
      if (this.matchPattern(pattern, event.type)) {
        for (const handler of patHandlers) {
          this.safeCall(handler, event);
        }
      }
    }
  }

  on<T = unknown>(type: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const h = handler as EventHandler;
    this.handlers.get(type)!.add(h);
    return () => this.off(type, h);
  }

  off(type: string, handler: EventHandler): void {
    const set = this.handlers.get(type);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(type);
    }
  }

  onCategory(category: EventCategory, handler: EventHandler): () => void {
    if (!this.categoryHandlers.has(category)) {
      this.categoryHandlers.set(category, new Set());
    }
    this.categoryHandlers.get(category)!.add(handler);
    return () => {
      const set = this.categoryHandlers.get(category);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this.categoryHandlers.delete(category);
      }
    };
  }

  onPattern(pattern: string, handler: EventHandler): () => void {
    if (!this.patternHandlers.has(pattern)) {
      this.patternHandlers.set(pattern, new Set());
    }
    this.patternHandlers.get(pattern)!.add(handler);
    return () => {
      const set = this.patternHandlers.get(pattern);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this.patternHandlers.delete(pattern);
      }
    };
  }

  clear(): void {
    this.handlers.clear();
    this.categoryHandlers.clear();
    this.patternHandlers.clear();
  }

  // --- Internal ---

  /**
   * Fire-and-forget handler execution.
   * Async handlers run without blocking; errors are logged but never propagate.
   */
  private safeCall<T>(handler: EventHandler<T>, event: TypedEvent<T>): void {
    try {
      const result = handler(event);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((err) => {
          console.error(`[EventBus] Async handler error for "${event.type}":`, err);
        });
      }
    } catch (err) {
      console.error(`[EventBus] Handler error for "${event.type}":`, err);
    }
  }

  /**
   * Match a dot-delimited pattern against an event type.
   * Supports '*' (single segment) and '**' (any depth).
   *
   * Examples:
   *   'agent.*' matches 'agent.complete', 'agent.error'
   *   'resource.**' matches 'resource.created', 'resource.goal.updated'
   *   'plugin.*.status' matches 'plugin.reminder.status'
   */
  private matchPattern(pattern: string, type: string): boolean {
    const patternParts = pattern.split('.');
    const typeParts = type.split('.');
    return this.matchParts(patternParts, 0, typeParts, 0);
  }

  private matchParts(
    pattern: string[], pi: number,
    type: string[], ti: number
  ): boolean {
    while (pi < pattern.length && ti < type.length) {
      if (pattern[pi] === '**') {
        // '**' matches zero or more segments
        // Try matching rest of pattern at every position
        for (let i = ti; i <= type.length; i++) {
          if (this.matchParts(pattern, pi + 1, type, i)) return true;
        }
        return false;
      }
      if (pattern[pi] !== '*' && pattern[pi] !== type[ti]) {
        return false;
      }
      pi++;
      ti++;
    }
    // Skip trailing '**'
    while (pi < pattern.length && pattern[pi] === '**') pi++;
    return pi === pattern.length && ti === type.length;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let globalEventBus: EventBus | null = null;

/**
 * Get the global EventBus singleton.
 * Creates one on first call.
 */
export function getEventBus(): IEventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus();
  }
  return globalEventBus;
}

/**
 * Reset the global EventBus (for testing).
 */
export function resetEventBus(): void {
  if (globalEventBus) {
    globalEventBus.clear();
  }
  globalEventBus = null;
}

// ============================================================================
// Helper: Create a typed event
// ============================================================================

/**
 * Convenience factory to create a TypedEvent with defaults filled in.
 */
export function createEvent<T>(
  type: string,
  category: EventCategory,
  source: string,
  data: T,
): TypedEvent<T> {
  return {
    type,
    category,
    timestamp: new Date().toISOString(),
    source,
    data,
  };
}
