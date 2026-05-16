/**
 * Plugin logger that redacts secrets/PII before persisting or forwarding.
 */

import type { PluginId } from '../../types/branded.js';
import { getLog } from '../../services/get-log.js';
import type { IsolatedLogger } from './types.js';

export class PluginIsolatedLogger implements IsolatedLogger {
  private readonly pluginId: PluginId;
  private readonly logs: Array<{
    level: string;
    message: string;
    data?: Record<string, unknown>;
    timestamp: Date;
  }> = [];
  private readonly maxLogs = 1000;

  constructor(pluginId: PluginId) {
    this.pluginId = pluginId;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  private log(level: string, message: string, data?: Record<string, unknown>): void {
    const sanitizedMessage = this.sanitize(message);
    const sanitizedData = data ? this.sanitizeObject(data) : undefined;

    const entry = {
      level,
      message: sanitizedMessage,
      data: sanitizedData,
      timestamp: new Date(),
    };

    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    const pluginLog = getLog(`Plugin:${this.pluginId}`);
    switch (level) {
      case 'debug':
        pluginLog.debug(sanitizedMessage, sanitizedData);
        break;
      case 'info':
        pluginLog.info(sanitizedMessage, sanitizedData);
        break;
      case 'warn':
        pluginLog.warn(sanitizedMessage, sanitizedData);
        break;
      case 'error':
        pluginLog.error(sanitizedMessage, sanitizedData);
        break;
    }
  }

  private sanitize(text: string): string {
    return text
      .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_API_KEY]')
      .replace(/ghp_[a-zA-Z0-9]{36}/g, '[REDACTED_GITHUB_TOKEN]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED_EMAIL]')
      .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED_PHONE]')
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[REDACTED_CARD]');
  }

  private sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (/password|secret|token|key|credential|auth/i.test(key)) {
        result[key] = '[REDACTED]';
        continue;
      }

      if (typeof value === 'string') {
        result[key] = this.sanitize(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'string'
            ? this.sanitize(item)
            : typeof item === 'object' && item !== null
              ? this.sanitizeObject(item as Record<string, unknown>)
              : item
        );
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.sanitizeObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Get logs (for debugging/admin).
   */
  getLogs(): typeof this.logs {
    return [...this.logs];
  }
}
