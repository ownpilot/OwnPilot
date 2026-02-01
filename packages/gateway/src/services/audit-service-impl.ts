/**
 * AuditService Implementation
 *
 * Wraps LogsRepository (DB request logs) and AuditLogger (file-based audit events)
 * behind the unified IAuditService interface.
 */

import type {
  IAuditService,
  RequestLogEntry,
  AuditLogEvent,
  LogFilter,
  LogStats,
} from '@ownpilot/core';
import { createLogsRepository, type LogsRepository } from '../db/repositories/logs.js';
import { getAuditLogger } from '../audit/index.js';

export class AuditService implements IAuditService {
  private logsRepo: LogsRepository;

  constructor(userId = 'default') {
    this.logsRepo = createLogsRepository(userId);
  }

  logRequest(entry: RequestLogEntry): void {
    // Fire-and-forget — don't block callers
    this.logsRepo.log({
      conversationId: entry.conversationId,
      type: entry.type,
      provider: entry.provider,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      durationMs: entry.durationMs,
      error: entry.error,
      statusCode: entry.success === false ? 500 : entry.success === true ? 200 : undefined,
    }).catch(() => {
      // Swallow errors — logging should never crash the caller
    });
  }

  logAudit(event: AuditLogEvent): void {
    const logger = getAuditLogger();
    logger.log({
      type: event.action as import('@ownpilot/core').AuditEventType,
      severity: 'info',
      actor: { type: 'user', id: event.userId },
      resource: { type: event.resource, id: event.resourceId ?? 'unknown' },
      outcome: 'success',
      details: event.details,
      correlationId: event.ip,
    });
  }

  async queryLogs(filter: LogFilter): Promise<RequestLogEntry[]> {
    const rows = await this.logsRepo.list({
      type: filter.type,
      provider: filter.provider,
      startDate: filter.since,
      endDate: filter.until,
      limit: filter.limit,
      offset: filter.offset,
    });

    return rows.map((row) => ({
      userId: row.userId,
      conversationId: row.conversationId ?? undefined,
      type: row.type as RequestLogEntry['type'],
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      inputTokens: row.inputTokens ?? undefined,
      outputTokens: row.outputTokens ?? undefined,
      durationMs: row.durationMs ?? undefined,
      success: row.error ? false : true,
      error: row.error ?? undefined,
    }));
  }

  async getStats(since?: Date): Promise<LogStats> {
    const stats = await this.logsRepo.getStats(since);

    return {
      totalRequests: stats.totalRequests,
      totalTokens: {
        input: stats.totalInputTokens,
        output: stats.totalOutputTokens,
      },
      averageDurationMs: stats.avgDurationMs,
      byProvider: stats.byProvider,
      byType: stats.byType,
      errorCount: stats.errorCount,
    };
  }
}

/**
 * Create a new AuditService instance.
 */
export function createAuditService(userId = 'default'): AuditService {
  return new AuditService(userId);
}
