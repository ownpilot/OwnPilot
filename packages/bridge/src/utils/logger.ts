/**
 * Pino logger setup for OpenClaw Bridge Daemon
 */

import pino from 'pino';

const logLevel = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level: logLevel,
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    pid: process.pid,
    service: 'openclaw-bridge',
  },
});

export function childLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
