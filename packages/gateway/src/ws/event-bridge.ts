/**
 * EventBusBridge
 *
 * Bidirectional bridge between the core EventBus and WebSocket clients.
 * Allows any WS client (UI, CLI, external scripts) to:
 * - Subscribe to EventBus events by pattern
 * - Publish events into the EventBus (restricted to allowed namespaces)
 *
 * Design:
 * - Each WS session creates its own onPattern() subscriptions
 * - Publishing is restricted to 'external.*' and 'client.*' namespaces
 * - Session cleanup automatically unsubscribes all patterns
 */

import {
  getEventSystem,
  type TypedEvent,
  type Unsubscribe,
  type EventCategory,
} from '@ownpilot/core';
import type { SessionManager } from './session.js';
import { getLog } from '../services/log.js';

const log = getLog('EventBusBridge');

// ============================================================================
// Constants
// ============================================================================

const MAX_SUBSCRIPTIONS_PER_SESSION = 50;
const ALLOWED_PUBLISH_PREFIXES = ['external.', 'client.'];
const BLOCKED_PUBLISH_PATTERNS = ['system.shutdown', 'system.startup'];
const MAX_PATTERN_LENGTH = 100;
const MAX_PATTERN_DEPTH = 6;

// ============================================================================
// EventBusBridge
// ============================================================================

export class EventBusBridge {
  private sessionManager: SessionManager;
  private running = false;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /** Start the bridge (no-op if already running) */
  start(): void {
    if (this.running) return;
    this.running = true;
    log.info('EventBusBridge started');
  }

  /** Stop the bridge */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    log.info('EventBusBridge stopped');
  }

  /** Whether the bridge is running */
  get isRunning(): boolean {
    return this.running;
  }

  // ---------- Client Operations ----------

  /**
   * Subscribe a WS session to EventBus events matching a pattern.
   * Returns true on success.
   */
  subscribe(sessionId: string, pattern: string): boolean {
    if (!this.running) return false;

    const error = this.validatePattern(pattern);
    if (error) {
      this.sessionManager.send(sessionId, 'event:subscribed', {
        pattern,
        success: false,
        error,
      });
      return false;
    }

    // Check subscription limit
    const existing = this.sessionManager.getEventSubscriptions(sessionId);
    if (existing.length >= MAX_SUBSCRIPTIONS_PER_SESSION && !existing.includes(pattern)) {
      this.sessionManager.send(sessionId, 'event:subscribed', {
        pattern,
        success: false,
        error: `Maximum subscriptions (${MAX_SUBSCRIPTIONS_PER_SESSION}) reached`,
      });
      return false;
    }

    // Create the EventBus subscription — when events match, forward to WS
    const eventSystem = getEventSystem();
    const unsub: Unsubscribe = eventSystem.onPattern(pattern, (event: TypedEvent) => {
      this.sessionManager.send(sessionId, 'event:message', {
        type: event.type,
        source: event.source,
        data: event.data,
        timestamp: event.timestamp,
      });
    });

    // Track in session manager (handles old subscription cleanup if duplicate pattern)
    const added = this.sessionManager.addEventSubscription(sessionId, pattern, unsub);
    if (!added) {
      unsub();
      this.sessionManager.send(sessionId, 'event:subscribed', {
        pattern,
        success: false,
        error: 'Failed to track subscription',
      });
      return false;
    }

    log.debug(`Session ${sessionId} subscribed to pattern: ${pattern}`);
    this.sessionManager.send(sessionId, 'event:subscribed', { pattern, success: true });
    return true;
  }

  /**
   * Unsubscribe a WS session from an EventBus pattern.
   */
  unsubscribe(sessionId: string, pattern: string): boolean {
    const removed = this.sessionManager.removeEventSubscription(sessionId, pattern);
    if (removed) {
      log.debug(`Session ${sessionId} unsubscribed from pattern: ${pattern}`);
    }
    this.sessionManager.send(sessionId, 'event:unsubscribed', { pattern });
    return removed;
  }

  /**
   * Publish an event from a WS client into the core EventBus.
   * Restricted to allowed namespaces.
   */
  publish(sessionId: string, type: string, data: unknown): boolean {
    if (!this.running) {
      this.sessionManager.send(sessionId, 'event:publish:error', {
        type,
        error: 'Bridge is not running',
      });
      return false;
    }

    const error = this.canPublish(type);
    if (error) {
      this.sessionManager.send(sessionId, 'event:publish:error', { type, error });
      return false;
    }

    // Emit into the core EventBus
    const eventSystem = getEventSystem();
    eventSystem.emitRaw({
      type,
      category: type.split('.')[0] as EventCategory,
      timestamp: new Date().toISOString(),
      source: `ws:${sessionId}`,
      data,
    });

    log.debug(`Session ${sessionId} published event: ${type}`);
    this.sessionManager.send(sessionId, 'event:publish:ack', { type });
    return true;
  }

  // ---------- Validation ----------

  /**
   * Validate a subscription pattern. Returns error message or null if valid.
   */
  private validatePattern(pattern: string): string | null {
    if (!pattern || typeof pattern !== 'string') {
      return 'Pattern must be a non-empty string';
    }
    if (pattern.length > MAX_PATTERN_LENGTH) {
      return `Pattern too long (max ${MAX_PATTERN_LENGTH} characters)`;
    }
    const segments = pattern.split('.');
    if (segments.length > MAX_PATTERN_DEPTH) {
      return `Pattern too deep (max ${MAX_PATTERN_DEPTH} segments)`;
    }
    // Only allow alphanumeric, hyphens, underscores, and wildcards
    if (!/^[a-zA-Z0-9_\-.*]+$/.test(pattern)) {
      return 'Pattern contains invalid characters';
    }
    return null;
  }

  /**
   * Check if a client is allowed to publish the given event type.
   * Returns error message or null if allowed.
   */
  private canPublish(type: string): string | null {
    if (!type || typeof type !== 'string') {
      return 'Event type must be a non-empty string';
    }
    if (type.length > MAX_PATTERN_LENGTH) {
      return `Event type too long (max ${MAX_PATTERN_LENGTH} characters)`;
    }
    // Must start with an allowed prefix
    const allowed = ALLOWED_PUBLISH_PREFIXES.some((prefix) => type.startsWith(prefix));
    if (!allowed) {
      return `Publishing restricted to namespaces: ${ALLOWED_PUBLISH_PREFIXES.join(', ')}`;
    }
    // Block specific patterns
    if (BLOCKED_PUBLISH_PATTERNS.includes(type)) {
      return `Event type '${type}' is blocked`;
    }
    return null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _bridge: EventBusBridge | null = null;

export function getEventBusBridge(): EventBusBridge | null {
  return _bridge;
}

export function setEventBusBridge(bridge: EventBusBridge): void {
  _bridge = bridge;
}
