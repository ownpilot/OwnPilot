/**
 * Logs Repository Tests
 *
 * Unit tests for LogsRepository: logging, error logging, listing with filters,
 * statistics, cleanup, and JSON serialization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = {
  type: 'postgres' as const,
  isConnected: () => true,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 1 })),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  exec: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  now: () => 'NOW()',
  date: (col: string) => `DATE(${col})`,
  dateSubtract: (col: string, n: number, u: string) => `${col} - INTERVAL '${n} ${u}'`,
  placeholder: (i: number) => `$${i}`,
  boolean: (v: boolean) => v,
  parseBoolean: (v: unknown) => Boolean(v),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { LogsRepository } from './logs.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    user_id: 'user-1',
    conversation_id: null,
    type: 'chat',
    provider: null,
    model: null,
    endpoint: null,
    method: 'POST',
    request_body: null,
    response_body: null,
    status_code: null,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    duration_ms: null,
    error: null,
    error_stack: null,
    ip_address: null,
    user_agent: null,
    created_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LogsRepository', () => {
  let repo: LogsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new LogsRepository('user-1');
  });

  // =========================================================================
  // log
  // =========================================================================

  describe('log', () => {
    it('should insert a log entry and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeLogRow());

      const result = await repo.log({ type: 'chat' });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.type).toBe('chat');
      expect(result.userId).toBe('user-1');
      expect(result.method).toBe('POST');
    });

    it('should pass all optional fields', async () => {
      const row = makeLogRow({
        conversation_id: 'conv-1',
        provider: 'openai',
        model: 'gpt-4',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        request_body: '{"messages":[]}',
        response_body: '{"choices":[]}',
        status_code: 200,
        input_tokens: 50,
        output_tokens: 100,
        total_tokens: 150,
        duration_ms: 1200,
        ip_address: '127.0.0.1',
        user_agent: 'Mozilla/5.0',
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.log({
        type: 'chat',
        conversationId: 'conv-1',
        provider: 'openai',
        model: 'gpt-4',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        requestBody: { messages: [] },
        responseBody: { choices: [] },
        statusCode: 200,
        inputTokens: 50,
        outputTokens: 100,
        totalTokens: 150,
        durationMs: 1200,
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      });

      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
      expect(result.statusCode).toBe(200);
      expect(result.inputTokens).toBe(50);
      expect(result.outputTokens).toBe(100);
    });

    it('should serialize requestBody as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeLogRow());

      await repo.log({
        type: 'chat',
        requestBody: { messages: [{ role: 'user', content: 'Hello' }] },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[8]).toBe(JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }));
    });

    it('should serialize responseBody as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeLogRow());

      await repo.log({
        type: 'chat',
        responseBody: { choices: [{ message: { content: 'Hi' } }] },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[9]).toBe(JSON.stringify({ choices: [{ message: { content: 'Hi' } }] }));
    });

    it('should set null for optional fields when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeLogRow());

      await repo.log({ type: 'chat' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBeNull(); // conversationId
      expect(params[4]).toBeNull(); // provider
      expect(params[5]).toBeNull(); // model
      expect(params[6]).toBeNull(); // endpoint
      expect(params[7]).toBe('POST'); // method default
      expect(params[8]).toBeNull(); // requestBody
      expect(params[9]).toBeNull(); // responseBody
      expect(params[10]).toBeNull(); // statusCode
      expect(params[11]).toBeNull(); // inputTokens
      expect(params[12]).toBeNull(); // outputTokens
      expect(params[13]).toBeNull(); // totalTokens
      expect(params[14]).toBeNull(); // durationMs
      expect(params[15]).toBeNull(); // error
      expect(params[16]).toBeNull(); // errorStack
      expect(params[17]).toBeNull(); // ipAddress
      expect(params[18]).toBeNull(); // userAgent
    });

    it('should return a fallback log entry when insert fails', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('DB connection lost'));

      const result = await repo.log({ type: 'chat', provider: 'openai' });

      // Should not throw, returns a fallback
      expect(result.type).toBe('chat');
      expect(result.provider).toBe('openai');
      expect(result.userId).toBe('user-1');
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should return fallback with correct fields when insert fails', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('DB error'));

      const result = await repo.log({
        type: 'tool',
        conversationId: 'conv-1',
        error: 'Tool failed',
        errorStack: 'stack trace',
        statusCode: 500,
      });

      expect(result.type).toBe('tool');
      expect(result.conversationId).toBe('conv-1');
      expect(result.error).toBe('Tool failed');
      expect(result.errorStack).toBe('stack trace');
      expect(result.statusCode).toBe(500);
    });

    it('should return fallback when getLog fails after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockRejectedValueOnce(new Error('Read failed'));

      const result = await repo.log({ type: 'chat' });

      // Should not throw, returns fallback
      expect(result.type).toBe('chat');
    });

    it('should pass error and errorStack fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeLogRow({ error: 'Something went wrong', error_stack: 'Error: Something...' })
      );

      await repo.log({
        type: 'chat',
        error: 'Something went wrong',
        errorStack: 'Error: Something...',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[15]).toBe('Something went wrong');
      expect(params[16]).toBe('Error: Something...');
    });
  });

  // =========================================================================
  // logError
  // =========================================================================

  describe('logError', () => {
    it('should log an error with statusCode 500', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeLogRow({ error: 'Timeout', error_stack: 'Error: Timeout\n  at ...', status_code: 500 })
      );

      const error = new Error('Timeout');
      const result = await repo.logError('chat', error);

      expect(result.error).toBe('Timeout');
      expect(result.statusCode).toBe(500);
    });

    it('should pass error stack', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeLogRow({ error: 'Fail' }));

      const error = new Error('Fail');
      await repo.logError('chat', error);

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[15]).toBe('Fail'); // error message
      expect(params[16]).toEqual(expect.stringContaining('Error: Fail')); // errorStack
    });

    it('should merge context with error data', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeLogRow({ provider: 'anthropic', error: 'Rate limited' })
      );

      const error = new Error('Rate limited');
      const result = await repo.logError('chat', error, { provider: 'anthropic' });

      expect(result.provider).toBe('anthropic');
    });
  });

  // =========================================================================
  // getLog
  // =========================================================================

  describe('getLog', () => {
    it('should return a log entry when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeLogRow());

      const result = await repo.getLog('log-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('log-1');
      expect(result!.type).toBe('chat');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getLog('missing')).toBeNull();
    });

    it('should parse createdAt as Date', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeLogRow());

      const result = await repo.getLog('log-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
    });

    it('should parse JSON requestBody and responseBody', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeLogRow({
          request_body: '{"prompt":"Hello"}',
          response_body: '{"text":"Hi"}',
        })
      );

      const result = await repo.getLog('log-1');

      expect(result!.requestBody).toEqual({ prompt: 'Hello' });
      expect(result!.responseBody).toEqual({ text: 'Hi' });
    });

    it('should return null for requestBody and responseBody when null in row', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeLogRow());

      const result = await repo.getLog('log-1');

      expect(result!.requestBody).toBeNull();
      expect(result!.responseBody).toBeNull();
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no logs', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should return mapped log entries', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeLogRow({ id: 'log-1' }),
        makeLogRow({ id: 'log-2', type: 'tool' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('log-1');
      expect(result[1]!.type).toBe('tool');
    });

    it('should filter by type', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ type: 'chat' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type = $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('chat');
    });

    it('should filter by conversationId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ conversationId: 'conv-1' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('conversation_id = $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('conv-1');
    });

    it('should filter by provider', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ provider: 'openai' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('provider = $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('openai');
    });

    it('should filter by hasError=true', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ hasError: true });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('error IS NOT NULL');
    });

    it('should filter by hasError=false', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ hasError: false });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('error IS NULL');
    });

    it('should filter by startDate', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const startDate = new Date('2025-01-01T00:00:00.000Z');
      await repo.list({ startDate });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('created_at >= $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(startDate.toISOString());
    });

    it('should filter by endDate', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const endDate = new Date('2025-01-31T23:59:59.000Z');
      await repo.list({ endDate });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('created_at <= $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(endDate.toISOString());
    });

    it('should apply pagination with LIMIT and OFFSET', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 10, offset: 20 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('should default to limit=100, offset=0', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(100);
      expect(params).toContain(0);
    });

    it('should order by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should scope to user_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('user-1');
    });

    it('should combine multiple filters', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({
        type: 'chat',
        provider: 'openai',
        hasError: false,
      });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type = $2');
      expect(sql).toContain('provider = $3');
      expect(sql).toContain('error IS NULL');
    });
  });

  // =========================================================================
  // getErrors
  // =========================================================================

  describe('getErrors', () => {
    it('should delegate to list with hasError=true', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getErrors();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('error IS NOT NULL');
    });

    it('should use default limit of 50', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getErrors();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(50);
    });

    it('should accept custom limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getErrors(10);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
    });
  });

  // =========================================================================
  // getConversationLogs
  // =========================================================================

  describe('getConversationLogs', () => {
    it('should delegate to list with conversationId and limit=1000', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getConversationLogs('conv-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('conversation_id = $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('conv-1');
      expect(params).toContain(1000);
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe('getStats', () => {
    it('should return aggregated statistics', async () => {
      // Main stats
      mockAdapter.queryOne.mockResolvedValueOnce({
        total_requests: '100',
        error_count: '5',
        success_count: '95',
        avg_duration_ms: '250.5',
        total_input_tokens: '10000',
        total_output_tokens: '20000',
      });
      // By provider
      mockAdapter.query.mockResolvedValueOnce([
        { provider: 'openai', count: '60' },
        { provider: 'anthropic', count: '40' },
      ]);
      // By type
      mockAdapter.query.mockResolvedValueOnce([
        { type: 'chat', count: '80' },
        { type: 'tool', count: '20' },
      ]);

      const stats = await repo.getStats();

      expect(stats.totalRequests).toBe(100);
      expect(stats.errorCount).toBe(5);
      expect(stats.successCount).toBe(95);
      expect(stats.avgDurationMs).toBeCloseTo(250.5);
      expect(stats.totalInputTokens).toBe(10000);
      expect(stats.totalOutputTokens).toBe(20000);
      expect(stats.byProvider).toEqual({ openai: 60, anthropic: 40 });
      expect(stats.byType).toEqual({ chat: 80, tool: 20 });
    });

    it('should return zeros when no data', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([]);

      const stats = await repo.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.byProvider).toEqual({});
      expect(stats.byType).toEqual({});
    });

    it('should filter by startDate', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([]);

      const startDate = new Date('2025-01-01T00:00:00.000Z');
      await repo.getStats(startDate);

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('created_at >= $');
    });

    it('should filter by endDate', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([]);

      const endDate = new Date('2025-01-31T23:59:59.000Z');
      await repo.getStats(undefined, endDate);

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('created_at <= $');
    });

    it('should filter by both startDate and endDate', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([]);

      const startDate = new Date('2025-01-01T00:00:00.000Z');
      const endDate = new Date('2025-01-31T23:59:59.000Z');
      await repo.getStats(startDate, endDate);

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('created_at >= $');
      expect(sql).toContain('created_at <= $');
    });

    it('should scope to user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getStats();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
    });

    it('should handle null avg_duration_ms', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        total_requests: '10',
        error_count: '0',
        success_count: '10',
        avg_duration_ms: null,
        total_input_tokens: '100',
        total_output_tokens: '200',
      });
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([]);

      const stats = await repo.getStats();

      expect(stats.avgDurationMs).toBe(0);
    });
  });

  // =========================================================================
  // deleteOldLogs
  // =========================================================================

  describe('deleteOldLogs', () => {
    it('should delete logs older than specified days', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 42 });

      const result = await repo.deleteOldLogs(30);

      expect(result).toBe(42);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM request_logs');
      expect(sql).toContain('created_at < $2');
    });

    it('should default to 30 days', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.deleteOldLogs();

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.deleteOldLogs();

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('user-1');
    });

    it('should return 0 when no logs deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteOldLogs(7);

      expect(result).toBe(0);
    });

    it('should pass cutoff date as ISO string', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.deleteOldLogs(30);

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // The second param should be an ISO date string
      const cutoffDate = params[1] as string;
      expect(cutoffDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // =========================================================================
  // clearAll
  // =========================================================================

  describe('clearAll', () => {
    it('should delete all logs for the user', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 100 });

      const result = await repo.clearAll();

      expect(result).toBe(100);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM request_logs');
      expect(sql).toContain('user_id = $1');
    });

    it('should return 0 when no logs exist', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.clearAll();

      expect(result).toBe(0);
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.clearAll();

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1']);
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createLogsRepository', () => {
    it('should be importable and return LogsRepository instance', async () => {
      const { createLogsRepository } = await import('./logs.js');
      const r = createLogsRepository('u1');
      expect(r).toBeInstanceOf(LogsRepository);
    });

    it('should default to "default" userId', async () => {
      const { createLogsRepository } = await import('./logs.js');
      const r = createLogsRepository();
      expect(r).toBeInstanceOf(LogsRepository);
    });
  });
});
