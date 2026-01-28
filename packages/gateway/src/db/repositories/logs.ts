/**
 * Request Logs Repository
 *
 * Logging all API requests for debugging and analytics
 */

import { getDatabase } from '../connection.js';

// =====================================================
// TYPES
// =====================================================

export interface RequestLog {
  id: string;
  userId: string;
  conversationId: string | null;
  type: 'chat' | 'completion' | 'embedding' | 'tool' | 'agent' | 'other';
  provider: string | null;
  model: string | null;
  endpoint: string | null;
  method: string;
  requestBody: unknown | null;
  responseBody: unknown | null;
  statusCode: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  error: string | null;
  errorStack: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface CreateLogInput {
  conversationId?: string;
  type: RequestLog['type'];
  provider?: string;
  model?: string;
  endpoint?: string;
  method?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  statusCode?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  error?: string;
  errorStack?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface LogQuery {
  type?: RequestLog['type'];
  conversationId?: string;
  provider?: string;
  hasError?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface LogStats {
  totalRequests: number;
  errorCount: number;
  successCount: number;
  avgDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: Record<string, number>;
  byType: Record<string, number>;
}

// =====================================================
// ROW TYPES
// =====================================================

interface LogRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  type: string;
  provider: string | null;
  model: string | null;
  endpoint: string | null;
  method: string;
  request_body: string | null;
  response_body: string | null;
  status_code: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  error: string | null;
  error_stack: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// =====================================================
// CONVERTER
// =====================================================

function rowToLog(row: LogRow): RequestLog {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    type: row.type as RequestLog['type'],
    provider: row.provider,
    model: row.model,
    endpoint: row.endpoint,
    method: row.method,
    requestBody: row.request_body ? JSON.parse(row.request_body) : null,
    responseBody: row.response_body ? JSON.parse(row.response_body) : null,
    statusCode: row.status_code,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    durationMs: row.duration_ms,
    error: row.error,
    errorStack: row.error_stack,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: new Date(row.created_at),
  };
}

// =====================================================
// REPOSITORY
// =====================================================

export class LogsRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  /**
   * Log a request (async-friendly, non-blocking)
   */
  log(input: CreateLogInput): RequestLog {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO request_logs (
          id, user_id, conversation_id, type, provider, model, endpoint, method,
          request_body, response_body, status_code, input_tokens, output_tokens,
          total_tokens, duration_ms, error, error_stack, ip_address, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        this.userId,
        input.conversationId || null,
        input.type,
        input.provider || null,
        input.model || null,
        input.endpoint || null,
        input.method || 'POST',
        input.requestBody ? JSON.stringify(input.requestBody) : null,
        input.responseBody ? JSON.stringify(input.responseBody) : null,
        input.statusCode || null,
        input.inputTokens || null,
        input.outputTokens || null,
        input.totalTokens || null,
        input.durationMs || null,
        input.error || null,
        input.errorStack || null,
        input.ipAddress || null,
        input.userAgent || null,
        now
      );

      return this.getLog(id)!;
    } catch (err) {
      // Don't throw - logging should never break the main flow
      console.error('[LogsRepository] Failed to log request:', err);
      return {
        id,
        userId: this.userId,
        conversationId: input.conversationId || null,
        type: input.type,
        provider: input.provider || null,
        model: input.model || null,
        endpoint: input.endpoint || null,
        method: input.method || 'POST',
        requestBody: input.requestBody || null,
        responseBody: input.responseBody || null,
        statusCode: input.statusCode || null,
        inputTokens: input.inputTokens || null,
        outputTokens: input.outputTokens || null,
        totalTokens: input.totalTokens || null,
        durationMs: input.durationMs || null,
        error: input.error || null,
        errorStack: input.errorStack || null,
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
        createdAt: new Date(now),
      };
    }
  }

  /**
   * Quick error log helper
   */
  logError(type: RequestLog['type'], error: Error, context?: Partial<CreateLogInput>): RequestLog {
    return this.log({
      ...context,
      type,
      error: error.message,
      errorStack: error.stack,
      statusCode: 500,
    });
  }

  getLog(id: string): RequestLog | null {
    const stmt = this.db.prepare(`SELECT * FROM request_logs WHERE id = ?`);
    const row = stmt.get(id) as LogRow | undefined;
    return row ? rowToLog(row) : null;
  }

  list(query: LogQuery = {}): RequestLog[] {
    const conditions: string[] = ['user_id = ?'];
    const params: unknown[] = [this.userId];

    if (query.type) {
      conditions.push('type = ?');
      params.push(query.type);
    }

    if (query.conversationId) {
      conditions.push('conversation_id = ?');
      params.push(query.conversationId);
    }

    if (query.provider) {
      conditions.push('provider = ?');
      params.push(query.provider);
    }

    if (query.hasError !== undefined) {
      if (query.hasError) {
        conditions.push('error IS NOT NULL');
      } else {
        conditions.push('error IS NULL');
      }
    }

    if (query.startDate) {
      conditions.push('created_at >= ?');
      params.push(query.startDate.toISOString());
    }

    if (query.endDate) {
      conditions.push('created_at <= ?');
      params.push(query.endDate.toISOString());
    }

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const sql = `
      SELECT * FROM request_logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params, limit, offset) as LogRow[];
    return rows.map(rowToLog);
  }

  /**
   * Get error logs only
   */
  getErrors(limit = 50): RequestLog[] {
    return this.list({ hasError: true, limit });
  }

  /**
   * Get logs for a specific conversation
   */
  getConversationLogs(conversationId: string): RequestLog[] {
    return this.list({ conversationId, limit: 1000 });
  }

  /**
   * Get statistics for a time period
   */
  getStats(startDate?: Date, endDate?: Date): LogStats {
    const conditions: string[] = ['user_id = ?'];
    const params: unknown[] = [this.userId];

    if (startDate) {
      conditions.push('created_at >= ?');
      params.push(startDate.toISOString());
    }

    if (endDate) {
      conditions.push('created_at <= ?');
      params.push(endDate.toISOString());
    }

    const whereClause = conditions.join(' AND ');

    // Main stats
    const mainStmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as error_count,
        SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as success_count,
        AVG(duration_ms) as avg_duration_ms,
        SUM(COALESCE(input_tokens, 0)) as total_input_tokens,
        SUM(COALESCE(output_tokens, 0)) as total_output_tokens
      FROM request_logs
      WHERE ${whereClause}
    `);

    const mainStats = mainStmt.get(...params) as {
      total_requests: number;
      error_count: number;
      success_count: number;
      avg_duration_ms: number | null;
      total_input_tokens: number;
      total_output_tokens: number;
    };

    // By provider
    const providerStmt = this.db.prepare(`
      SELECT provider, COUNT(*) as count
      FROM request_logs
      WHERE ${whereClause} AND provider IS NOT NULL
      GROUP BY provider
    `);

    const providerRows = providerStmt.all(...params) as Array<{ provider: string; count: number }>;
    const byProvider: Record<string, number> = {};
    for (const row of providerRows) {
      byProvider[row.provider] = row.count;
    }

    // By type
    const typeStmt = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM request_logs
      WHERE ${whereClause}
      GROUP BY type
    `);

    const typeRows = typeStmt.all(...params) as Array<{ type: string; count: number }>;
    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.type] = row.count;
    }

    return {
      totalRequests: mainStats.total_requests,
      errorCount: mainStats.error_count,
      successCount: mainStats.success_count,
      avgDurationMs: mainStats.avg_duration_ms ?? 0,
      totalInputTokens: mainStats.total_input_tokens,
      totalOutputTokens: mainStats.total_output_tokens,
      byProvider,
      byType,
    };
  }

  /**
   * Delete old logs (cleanup)
   */
  deleteOldLogs(olderThanDays = 30): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const stmt = this.db.prepare(`
      DELETE FROM request_logs
      WHERE user_id = ? AND created_at < ?
    `);

    const result = stmt.run(this.userId, cutoff.toISOString());
    return result.changes;
  }

  /**
   * Clear all logs for this user
   */
  clearAll(): number {
    const stmt = this.db.prepare(`DELETE FROM request_logs WHERE user_id = ?`);
    const result = stmt.run(this.userId);
    return result.changes;
  }
}

// Default export for convenience
export const logsRepository = new LogsRepository();
