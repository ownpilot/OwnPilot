/**
 * IAuditService - Unified Audit & Request Logging Interface
 *
 * Provides a single service for all audit, request, and debug logging.
 * Wraps RequestLogsRepository + AuditLogger.
 *
 * Usage:
 *   const audit = registry.get(Services.Audit);
 *   audit.logRequest({
 *     userId: 'default',
 *     type: 'chat',
 *     provider: 'openai',
 *     model: 'gpt-4o',
 *     inputTokens: 500,
 *     outputTokens: 200,
 *     durationMs: 1200,
 *   });
 */

// ============================================================================
// Types
// ============================================================================

export type RequestType = 'chat' | 'completion' | 'embedding' | 'tool' | 'agent' | 'other';

export interface RequestLogEntry {
  readonly userId: string;
  readonly conversationId?: string;
  readonly type: RequestType;
  readonly provider?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly durationMs?: number;
  readonly success?: boolean;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditLogEvent {
  readonly userId: string;
  readonly action: string;
  readonly resource: string;
  readonly resourceId?: string;
  readonly details?: Record<string, unknown>;
  readonly ip?: string;
}

export interface LogFilter {
  readonly userId?: string;
  readonly type?: RequestType;
  readonly provider?: string;
  readonly since?: Date;
  readonly until?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

export interface LogStats {
  readonly totalRequests: number;
  readonly totalTokens: { input: number; output: number };
  readonly averageDurationMs: number;
  readonly byProvider: Record<string, number>;
  readonly byType: Record<string, number>;
  readonly errorCount: number;
}

// ============================================================================
// IAuditService
// ============================================================================

export interface IAuditService {
  /**
   * Log an API request (chat, completion, tool call, etc.).
   */
  logRequest(entry: RequestLogEntry): void;

  /**
   * Log an audit event (user action, security event, etc.).
   */
  logAudit(event: AuditLogEvent): void;

  /**
   * Query request logs.
   */
  queryLogs(filter: LogFilter): Promise<RequestLogEntry[]>;

  /**
   * Get usage statistics.
   */
  getStats(since?: Date): Promise<LogStats>;
}

// ============================================================================
// Singleton access — matches the LLMRouter / ChannelService / ConfigCenter /
// PermissionGate / MemoryService pattern. Audit is the 7th horizontal
// capability promoted to core so runtimes can emit audit events through
// `ctx.audit.*` instead of resolving from the registry per-call.
// ============================================================================

import { hasServiceRegistry, getServiceRegistry } from './registry.js';
import { ServiceToken } from './registry.js';

/**
 * Service registry token for the AuditService. The same token instance is
 * exposed as `Services.Audit` in tokens.ts.
 */
export const AuditToken = new ServiceToken<IAuditService>('audit');

let _auditService: IAuditService | null = null;

/**
 * Register the AuditService implementation. Called once at gateway
 * startup. Also mirrors into the service registry so legacy callers that
 * resolve through `Services.Audit` still work.
 */
export function setAuditService(service: IAuditService): void {
  _auditService = service;

  if (hasServiceRegistry()) {
    try {
      const registry = getServiceRegistry();
      if (!registry.has(AuditToken)) {
        registry.register(AuditToken, service);
      }
    } catch {
      // Registry not ready
    }
  }
}

/**
 * Get the AuditService. Tries the service registry first, falls back to
 * the direct singleton. Throws if neither is initialized.
 */
export function getAuditService(): IAuditService {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(AuditToken);
    } catch {
      // Not registered yet — fall through to direct singleton
    }
  }

  if (!_auditService) {
    throw new Error('AuditService not initialized. Call setAuditService() during gateway startup.');
  }
  return _auditService;
}

/** Check whether the AuditService has been initialized. */
export function hasAuditService(): boolean {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().has(AuditToken);
    } catch {
      // fall through
    }
  }
  return _auditService !== null;
}
