/**
 * Plugin-scoped event bus with allowlist for incoming events
 * and namespace prefixing for outgoing events.
 */

import { EventEmitter } from 'node:events';
import type { PluginId } from '../../types/branded.js';
import { getLog } from '../../services/get-log.js';
import type { AllowedPluginEvent, IsolatedEvents } from './types.js';

export class PluginIsolatedEvents implements IsolatedEvents {
  private readonly pluginId: PluginId;
  private readonly emitter = new EventEmitter();
  private readonly allowedEvents: Set<AllowedPluginEvent> = new Set([
    'plugin:enabled',
    'plugin:disabled',
    'plugin:config_changed',
    'message:received',
    'tool:called',
    'schedule:triggered',
  ]);

  constructor(pluginId: PluginId) {
    this.pluginId = pluginId;
    this.emitter.setMaxListeners(20);
  }

  on(event: AllowedPluginEvent, handler: (data: unknown) => void): () => void {
    if (!this.allowedEvents.has(event)) {
      getLog(`Plugin:${this.pluginId}`).warn(
        `Attempted to subscribe to disallowed event: ${event}`
      );
      return () => {};
    }

    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }

  emit(event: string, data: unknown): void {
    // Plugins can only emit to their own namespace
    const scopedEvent = `plugin:${this.pluginId}:${event}`;
    this.emitter.emit(scopedEvent, this.sanitizeData(data));
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  /**
   * Internal: dispatch event from system to plugin.
   */
  _dispatch(event: AllowedPluginEvent, data: unknown): void {
    this.emitter.emit(event, this.sanitizeData(data));
  }

  private sanitizeData(data: unknown): unknown {
    // Remove potential PII or sensitive data
    if (typeof data !== 'object' || data === null) return data;

    const sanitized = { ...(data as Record<string, unknown>) };

    const sensitiveFields = [
      'password',
      'token',
      'apiKey',
      'secret',
      'credential',
      'ssn',
      'creditCard',
    ];

    for (const field of sensitiveFields) {
      delete sanitized[field];
      delete sanitized[field.toLowerCase()];
      delete sanitized[field.toUpperCase()];
    }

    return sanitized;
  }
}
