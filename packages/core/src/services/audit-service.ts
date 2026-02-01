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
