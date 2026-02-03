/**
 * Logging Utility
 *
 * Provides easy access to scoped loggers anywhere in the codebase.
 * Falls back to console if ServiceRegistry isn't initialized yet.
 *
 * Usage:
 *   import { getLog } from '@ownpilot/core';
 *   const log = getLog('Chat');
 *   log.info('Processing message', { sessionId: '...' });
 */

import { hasServiceRegistry, getServiceRegistry } from './registry.js';
import { Services } from './tokens.js';
import type { ILogService } from './log-service.js';

const fallbackLoggers = new Map<string, ILogService>();

function createFallbackLogger(module: string): ILogService {
  return {
    debug(msg, data) { if (data) console.debug(`[${module}]`, msg, data); else console.debug(`[${module}]`, msg); },
    info(msg, data) { if (data) console.log(`[${module}]`, msg, data); else console.log(`[${module}]`, msg); },
    warn(msg, data) { if (data) console.warn(`[${module}]`, msg, data); else console.warn(`[${module}]`, msg); },
    error(msg, data) { if (data) console.error(`[${module}]`, msg, data); else console.error(`[${module}]`, msg); },
    child(sub: string) { return getLog(`${module}:${sub}`); },
  };
}

/**
 * Get a scoped logger for a module.
 * Uses ServiceRegistry if available, falls back to console.
 */
export function getLog(module: string): ILogService {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(Services.Log).child(module);
    } catch {
      // Registry exists but Log service not registered yet
    }
  }

  let logger = fallbackLoggers.get(module);
  if (!logger) {
    logger = createFallbackLogger(module);
    fallbackLoggers.set(module, logger);
  }
  return logger;
}
