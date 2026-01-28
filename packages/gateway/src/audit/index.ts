/**
 * Gateway Audit Logger
 *
 * Provides tamper-evident audit logging for all agent activities,
 * tool executions, and system events.
 */

import { join } from 'node:path';
import { createAuditLogger, type AuditLogger, type AuditEventInput } from '@ownpilot/core';
import { getDataPaths } from '../paths/index.js';

// Audit log path will be initialized lazily
let AUDIT_LOG_PATH: string | null = null;

function getAuditLogPath(): string {
  if (!AUDIT_LOG_PATH) {
    const paths = getDataPaths();
    AUDIT_LOG_PATH = join(paths.logs, 'gateway-audit.jsonl');
  }
  return AUDIT_LOG_PATH;
}

// Global audit logger instance
let auditLogger: AuditLogger | null = null;

/**
 * Get or create the audit logger instance
 */
export function getAuditLogger(): AuditLogger {
  if (!auditLogger) {
    auditLogger = createAuditLogger({
      path: getAuditLogPath(),
      minSeverity: 'debug',
      console: process.env.NODE_ENV === 'development',
    });
  }
  return auditLogger;
}

/**
 * Log a tool execution event
 */
export async function logToolExecution(params: {
  toolName: string;
  toolId?: string;
  agentId: string;
  sessionId: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  durationMs: number;
  requestId?: string;
}): Promise<void> {
  const logger = getAuditLogger();

  const event: AuditEventInput = {
    type: params.error ? 'tool.error' : 'tool.success',
    severity: params.error ? 'error' : 'info',
    actor: {
      type: 'agent',
      id: params.agentId,
    },
    resource: {
      type: 'tool',
      id: params.toolId ?? params.toolName,
      name: params.toolName,
    },
    outcome: params.error ? 'failure' : 'success',
    details: {
      input: sanitizeForAudit(params.input),
      output: params.output ? sanitizeForAudit(params.output) : undefined,
      error: params.error,
      durationMs: params.durationMs,
    },
    correlationId: params.requestId,
  };

  await logger.log(event);
}

/**
 * Log a chat/completion event
 */
export async function logChatEvent(params: {
  type: 'start' | 'complete' | 'error';
  agentId: string;
  sessionId: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  error?: string;
  requestId?: string;
  toolCallCount?: number;
}): Promise<void> {
  const logger = getAuditLogger();

  // Map chat event types to audit event types
  const eventType = params.type === 'error'
    ? 'system.error'  // Use system.error for chat errors
    : params.type === 'start'
      ? 'message.receive'
      : 'message.send';

  const event: AuditEventInput = {
    type: eventType,
    severity: params.error ? 'error' : 'info',
    actor: {
      type: 'agent',
      id: params.agentId,
    },
    resource: {
      type: 'session',
      id: params.sessionId,
      name: `${params.provider}/${params.model}`,
    },
    outcome: params.error ? 'failure' : 'success',
    details: {
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      durationMs: params.durationMs,
      toolCallCount: params.toolCallCount,
      error: params.error,
    },
    correlationId: params.requestId,
  };

  await logger.log(event);
}

/**
 * Log an agent lifecycle event
 */
export async function logAgentEvent(params: {
  type: 'create' | 'destroy' | 'config_change';
  agentId: string;
  agentName?: string;
  details?: Record<string, unknown>;
  requestId?: string;
}): Promise<void> {
  const logger = getAuditLogger();

  const eventTypeMap = {
    create: 'session.create',
    destroy: 'session.destroy',
    config_change: 'config.change',
  } as const;

  const event: AuditEventInput = {
    type: eventTypeMap[params.type],
    severity: 'info',
    actor: {
      type: 'system',
      id: 'gateway',
    },
    resource: {
      type: 'agent',
      id: params.agentId,
      name: params.agentName,
    },
    outcome: 'success',
    details: params.details ?? {},
    correlationId: params.requestId,
  };

  await logger.log(event);
}

/**
 * Log a system event
 */
export async function logSystemEvent(params: {
  type: 'start' | 'stop' | 'error' | 'health_check';
  details?: Record<string, unknown>;
  error?: string;
}): Promise<void> {
  const logger = getAuditLogger();

  const eventTypeMap = {
    start: 'system.start',
    stop: 'system.stop',
    error: 'system.error',
    health_check: 'system.health_check',
  } as const;

  const event: AuditEventInput = {
    type: eventTypeMap[params.type],
    severity: params.error ? 'error' : 'info',
    actor: {
      type: 'system',
      id: 'gateway',
    },
    resource: {
      type: 'system',
      id: 'gateway',
      name: 'OwnPilot',
    },
    outcome: params.error ? 'failure' : 'success',
    details: {
      ...params.details,
      error: params.error,
    },
  };

  await logger.log(event);
}

/**
 * Sanitize data for audit logging (remove sensitive info, truncate large values)
 */
function sanitizeForAudit(data: unknown, maxLength = 1000): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Truncate long strings
    if (data.length > maxLength) {
      return data.slice(0, maxLength) + `... [truncated ${data.length - maxLength} chars]`;
    }
    return data;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (Array.isArray(data)) {
    if (data.length > 10) {
      return [...data.slice(0, 10).map(item => sanitizeForAudit(item, maxLength)), `... [${data.length - 10} more items]`];
    }
    return data.map(item => sanitizeForAudit(item, maxLength));
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'apiKey', 'api_key', 'secret', 'token', 'authorization', 'credential'];

    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      // Mask sensitive fields
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeForAudit(value, maxLength);
      }
    }
    return sanitized;
  }

  return String(data);
}

// Export types
export type { AuditLogger, AuditEventInput };
