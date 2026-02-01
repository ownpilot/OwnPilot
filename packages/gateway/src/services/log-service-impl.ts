/**
 * LogService Implementation
 *
 * Structured logging with two modes:
 * - Development: Human-readable colored output with module prefix
 * - Production: JSON structured output
 *
 * Usage:
 *   const log = createLogService({ level: 'info' });
 *   log.info('Server started', { port: 8080 });
 *
 *   const chatLog = log.child('Chat');
 *   chatLog.info('Processing message');
 *   // Dev:  [Chat] Processing message
 *   // Prod: {"level":"info","ts":"...","module":"Chat","msg":"Processing message"}
 */

import type { ILogService, LogLevel } from '@ownpilot/core';

export interface LogServiceOptions {
  level?: LogLevel;
  json?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class LogService implements ILogService {
  private readonly level: number;
  private readonly module: string | null;
  private readonly json: boolean;

  constructor(options?: LogServiceOptions & { module?: string }) {
    this.level = LOG_LEVELS[options?.level ?? 'info'];
    this.module = options?.module ?? null;
    this.json = options?.json ?? (process.env.NODE_ENV === 'production');
  }

  debug(message: string, data?: unknown): void {
    if (this.level <= LOG_LEVELS.debug) this.write('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    if (this.level <= LOG_LEVELS.info) this.write('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    if (this.level <= LOG_LEVELS.warn) this.write('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.write('error', message, data);
  }

  child(module: string): ILogService {
    const childModule = this.module ? `${this.module}:${module}` : module;
    const levelName = (Object.entries(LOG_LEVELS).find(([, v]) => v === this.level)?.[0] ?? 'info') as LogLevel;
    return new LogService({
      level: levelName,
      json: this.json,
      module: childModule,
    });
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    const fn = level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'debug'
          ? console.debug
          : console.log;

    if (this.json) {
      const record = data && typeof data === 'object' && !Array.isArray(data) && !(data instanceof Error)
        ? data as Record<string, unknown>
        : data !== undefined ? { data } : {};
      fn(JSON.stringify({
        level,
        ts: new Date().toISOString(),
        ...(this.module ? { module: this.module } : {}),
        msg: message,
        ...record,
      }));
    } else {
      const prefix = this.module ? `[${this.module}]` : '';
      if (data !== undefined) {
        fn(`${prefix} ${message}`, data);
      } else {
        fn(`${prefix} ${message}`);
      }
    }
  }
}

/**
 * Create a new LogService instance.
 */
export function createLogService(options?: LogServiceOptions): ILogService {
  return new LogService(options);
}
