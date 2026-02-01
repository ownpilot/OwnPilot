/**
 * AuditService Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService, createAuditService } from './audit-service-impl.js';

// Mock LogsRepository
const mockLog = vi.fn().mockResolvedValue(undefined);
const mockList = vi.fn().mockResolvedValue([]);
const mockGetStats = vi.fn().mockResolvedValue({
  totalRequests: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  avgDurationMs: 0,
  byProvider: {},
  byType: {},
  errorCount: 0,
});

vi.mock('../db/repositories/logs.js', () => ({
  createLogsRepository: () => ({
    log: mockLog,
    list: mockList,
    getStats: mockGetStats,
  }),
}));

// Mock AuditLogger
const mockAuditLog = vi.fn();
vi.mock('../audit/index.js', () => ({
  getAuditLogger: () => ({
    log: mockAuditLog,
  }),
}));

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuditService('test-user');
  });

  describe('logRequest', () => {
    it('delegates to LogsRepository with mapped fields', () => {
      service.logRequest({
        userId: 'user-1',
        type: 'chat',
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 1200,
        conversationId: 'conv-1',
        success: true,
      });

      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          type: 'chat',
          provider: 'openai',
          model: 'gpt-4o',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 1200,
          statusCode: 200,
        })
      );
    });

    it('maps success=false to statusCode 500', () => {
      service.logRequest({
        userId: 'user-1',
        type: 'chat',
        success: false,
        error: 'timeout',
      });

      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          error: 'timeout',
        })
      );
    });

    it('does not throw when log rejects', async () => {
      mockLog.mockRejectedValueOnce(new Error('DB error'));

      // Should not throw — fire-and-forget
      expect(() => {
        service.logRequest({
          userId: 'user-1',
          type: 'chat',
        });
      }).not.toThrow();
    });
  });

  describe('logAudit', () => {
    it('delegates to AuditLogger with mapped fields', () => {
      service.logAudit({
        userId: 'user-1',
        action: 'tool_execute',
        resource: 'tool',
        resourceId: 'web_search',
        ip: '127.0.0.1',
        details: { query: 'test' },
      });

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_execute',
          severity: 'info',
          actor: { type: 'user', id: 'user-1' },
          resource: { type: 'tool', id: 'web_search' },
          outcome: 'success',
          details: { query: 'test' },
          correlationId: '127.0.0.1',
        })
      );
    });

    it('uses "unknown" when resourceId is missing', () => {
      service.logAudit({
        userId: 'user-1',
        action: 'login',
        resource: 'auth',
      });

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: { type: 'auth', id: 'unknown' },
        })
      );
    });
  });

  describe('queryLogs', () => {
    it('maps filter params and returns transformed rows', async () => {
      const now = new Date();
      mockList.mockResolvedValueOnce([
        {
          userId: 'user-1',
          conversationId: 'conv-1',
          type: 'chat',
          provider: 'openai',
          model: 'gpt-4o',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 800,
          error: null,
        },
      ]);

      const results = await service.queryLogs({
        type: 'chat',
        provider: 'openai',
        since: now,
        limit: 10,
        offset: 0,
      });

      expect(mockList).toHaveBeenCalledWith({
        type: 'chat',
        provider: 'openai',
        startDate: now,
        endDate: undefined,
        limit: 10,
        offset: 0,
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({
          userId: 'user-1',
          conversationId: 'conv-1',
          type: 'chat',
          provider: 'openai',
          model: 'gpt-4o',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 800,
          success: true,
        })
      );
    });

    it('maps error rows as success: false', async () => {
      mockList.mockResolvedValueOnce([
        {
          userId: 'user-1',
          type: 'chat',
          error: 'timeout',
          conversationId: null,
          provider: null,
          model: null,
          inputTokens: null,
          outputTokens: null,
          durationMs: null,
        },
      ]);

      const results = await service.queryLogs({});
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('timeout');
    });
  });

  describe('getStats', () => {
    it('maps LogsRepository stats to LogStats format', async () => {
      mockGetStats.mockResolvedValueOnce({
        totalRequests: 100,
        totalInputTokens: 5000,
        totalOutputTokens: 3000,
        avgDurationMs: 450,
        byProvider: { openai: 80, anthropic: 20 },
        byType: { chat: 90, tool: 10 },
        errorCount: 5,
      });

      const stats = await service.getStats();

      expect(stats).toEqual({
        totalRequests: 100,
        totalTokens: { input: 5000, output: 3000 },
        averageDurationMs: 450,
        byProvider: { openai: 80, anthropic: 20 },
        byType: { chat: 90, tool: 10 },
        errorCount: 5,
      });
    });

    it('passes since date filter', async () => {
      const since = new Date('2025-01-01');
      await service.getStats(since);

      expect(mockGetStats).toHaveBeenCalledWith(since);
    });
  });

  describe('createAuditService factory', () => {
    it('returns an AuditService instance', () => {
      const svc = createAuditService('user-1');
      expect(svc).toBeInstanceOf(AuditService);
    });
  });
});
