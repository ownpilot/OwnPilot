/**
 * ILogService - Unified Structured Logging Interface
 *
 * Replaces scattered console.log('[Module]', ...) calls
 * with a consistent, structured logging API.
 *
 * Usage:
 *   const log = registry.get(Services.Log);
 *   log.info('Server started', { port: 8080 });
 *
 *   // Scoped logger for a module
 *   const chatLog = log.child('Chat');
 *   chatLog.info('Processing message', { sessionId: '...' });
 *   // Output: [Chat] Processing message { sessionId: '...' }
 */

export interface ILogService {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;

  /**
   * Create a child logger scoped to a module.
   * The module name is prepended to all log messages.
   */
  child(module: string): ILogService;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
