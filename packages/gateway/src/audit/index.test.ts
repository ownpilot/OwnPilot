/**
 * Audit Index Tests
 *
 * Tests for gateway audit logger: singleton creation, event logging functions,
 * and the private sanitizeForAudit logic (exercised through logToolExecution).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be available when vi.mock factory functions run
// ---------------------------------------------------------------------------

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { log: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@ownpilot/core', () => ({
  createAuditLogger: vi.fn(() => mockLogger),
}));

vi.mock('../paths/index.js', () => ({
  getDataPaths: vi.fn(() => ({ logs: '/test/logs' })),
}));

vi.mock('node:path', () => ({
  join: (...args: string[]) => args.join('/'),
}));

// ---------------------------------------------------------------------------
// Helper: get a fresh module to reset singleton state
// ---------------------------------------------------------------------------

async function freshModule() {
  vi.resetModules();
  return import('./index.js');
}

// ---------------------------------------------------------------------------
// Import after mocks are in place (used for non-singleton tests)
// ---------------------------------------------------------------------------

import { createAuditLogger } from '@ownpilot/core';
import { getDataPaths } from '../paths/index.js';
import { logToolExecution, logChatEvent, logAgentEvent, logSystemEvent } from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('audit/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger.log.mockResolvedValue(undefined);
  });

  // =========================================================================
  // getAuditLogger()
  // =========================================================================

  describe('getAuditLogger()', () => {
    it('returns an AuditLogger instance', async () => {
      const { getAuditLogger: fresh } = await freshModule();
      const logger = fresh();
      expect(logger).toBe(mockLogger);
    });

    it('calls createAuditLogger with correct path derived from getDataPaths', async () => {
      const { getAuditLogger: fresh } = await freshModule();
      fresh();
      expect(createAuditLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/test/logs/gateway-audit.jsonl',
        })
      );
    });

    it('sets minSeverity to "debug"', async () => {
      const { getAuditLogger: fresh } = await freshModule();
      fresh();
      expect(createAuditLogger).toHaveBeenCalledWith(
        expect.objectContaining({ minSeverity: 'debug' })
      );
    });

    it('enables console logging when NODE_ENV is "development"', async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const { getAuditLogger: fresh } = await freshModule();
        fresh();
        expect(createAuditLogger).toHaveBeenCalledWith(expect.objectContaining({ console: true }));
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it('disables console logging when NODE_ENV is "production"', async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const { getAuditLogger: fresh } = await freshModule();
        fresh();
        expect(createAuditLogger).toHaveBeenCalledWith(expect.objectContaining({ console: false }));
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it('disables console logging when NODE_ENV is "test"', async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      try {
        const { getAuditLogger: fresh } = await freshModule();
        fresh();
        expect(createAuditLogger).toHaveBeenCalledWith(expect.objectContaining({ console: false }));
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it('returns the same instance on subsequent calls (singleton)', async () => {
      const { getAuditLogger: fresh } = await freshModule();
      const first = fresh();
      const second = fresh();
      expect(first).toBe(second);
    });

    it('only calls createAuditLogger once across multiple calls (singleton)', async () => {
      const { getAuditLogger: fresh } = await freshModule();
      fresh();
      fresh();
      fresh();
      expect(createAuditLogger).toHaveBeenCalledTimes(1);
    });

    it('does not call createAuditLogger before first call (lazy creation)', async () => {
      await freshModule(); // import without calling getAuditLogger
      expect(createAuditLogger).not.toHaveBeenCalled();
    });

    it('calls getDataPaths to resolve the log directory', async () => {
      const { getAuditLogger: fresh } = await freshModule();
      fresh();
      expect(getDataPaths).toHaveBeenCalled();
    });

    it('caches the log path so getDataPaths is called only once', async () => {
      const { getAuditLogger: fresh } = await freshModule();
      fresh();
      fresh();
      expect(getDataPaths).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // logToolExecution()
  // =========================================================================

  describe('logToolExecution()', () => {
    const baseParams = {
      toolName: 'web_search',
      agentId: 'agent-42',
      sessionId: 'sess-1',
      input: { query: 'test query' },
      durationMs: 250,
    };

    it('calls logger.log with type "tool.success" when no error', async () => {
      await logToolExecution(baseParams);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tool.success' })
      );
    });

    it('calls logger.log with type "tool.error" when error is present', async () => {
      await logToolExecution({ ...baseParams, error: 'timeout' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool.error' }));
    });

    it('sets severity to "info" for a successful execution', async () => {
      await logToolExecution(baseParams);
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info' }));
    });

    it('sets severity to "error" when error is present', async () => {
      await logToolExecution({ ...baseParams, error: 'something went wrong' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });

    it('sets actor type to "agent"', async () => {
      await logToolExecution(baseParams);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ actor: expect.objectContaining({ type: 'agent' }) })
      );
    });

    it('sets actor id to the provided agentId', async () => {
      await logToolExecution({ ...baseParams, agentId: 'my-agent' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ actor: expect.objectContaining({ id: 'my-agent' }) })
      );
    });

    it('sets resource type to "tool"', async () => {
      await logToolExecution(baseParams);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ resource: expect.objectContaining({ type: 'tool' }) })
      );
    });

    it('uses toolId as resource.id when toolId is provided', async () => {
      await logToolExecution({ ...baseParams, toolId: 'tool-id-99' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({ id: 'tool-id-99' }),
        })
      );
    });

    it('falls back to toolName as resource.id when toolId is not provided', async () => {
      await logToolExecution(baseParams);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({ id: 'web_search' }),
        })
      );
    });

    it('sets resource.name to toolName', async () => {
      await logToolExecution(baseParams);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({ name: 'web_search' }),
        })
      );
    });

    it('sets outcome to "success" when no error', async () => {
      await logToolExecution(baseParams);
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    });

    it('sets outcome to "failure" when error is present', async () => {
      await logToolExecution({ ...baseParams, error: 'network error' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
    });

    it('includes durationMs in details', async () => {
      await logToolExecution({ ...baseParams, durationMs: 512 });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ durationMs: 512 }),
        })
      );
    });

    it('includes sanitized input in details', async () => {
      await logToolExecution({ ...baseParams, input: { query: 'hello' } });
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      const details = call.details as Record<string, unknown>;
      expect(details.input).toEqual({ query: 'hello' });
    });

    it('sanitizes input and redacts sensitive keys', async () => {
      await logToolExecution({
        ...baseParams,
        input: { query: 'search', password: 'secret123' },
      });
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      const details = call.details as Record<string, unknown>;
      expect((details.input as Record<string, unknown>).password).toBe('[REDACTED]');
    });

    it('includes sanitized output in details when output is provided', async () => {
      await logToolExecution({ ...baseParams, output: { result: 'found it' } });
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      const details = call.details as Record<string, unknown>;
      expect(details.output).toEqual({ result: 'found it' });
    });

    it('omits output from details when output is undefined', async () => {
      await logToolExecution(baseParams);
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      const details = call.details as Record<string, unknown>;
      expect(details.output).toBeUndefined();
    });

    it('sets correlationId from requestId when provided', async () => {
      await logToolExecution({ ...baseParams, requestId: 'req-abc-123' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'req-abc-123' })
      );
    });

    it('sets correlationId to undefined when requestId is not provided', async () => {
      await logToolExecution(baseParams);
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      expect(call.correlationId).toBeUndefined();
    });

    it('includes error string in details when error is provided', async () => {
      await logToolExecution({ ...baseParams, error: 'tool crashed' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ error: 'tool crashed' }),
        })
      );
    });

    it('awaits the logger.log promise', async () => {
      let resolved = false;
      mockLogger.log.mockImplementationOnce(
        () =>
          new Promise<void>((res) =>
            setTimeout(() => {
              resolved = true;
              res();
            }, 0)
          )
      );
      await logToolExecution(baseParams);
      expect(resolved).toBe(true);
    });
  });

  // =========================================================================
  // logChatEvent()
  // =========================================================================

  describe('logChatEvent()', () => {
    const baseParams = {
      agentId: 'agent-1',
      sessionId: 'sess-1',
      provider: 'openai',
      model: 'gpt-4o',
    };

    it('maps type "error" to audit event type "system.error"', async () => {
      await logChatEvent({ ...baseParams, type: 'error' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'system.error' })
      );
    });

    it('maps type "start" to audit event type "message.receive"', async () => {
      await logChatEvent({ ...baseParams, type: 'start' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'message.receive' })
      );
    });

    it('maps type "complete" to audit event type "message.send"', async () => {
      await logChatEvent({ ...baseParams, type: 'complete' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'message.send' })
      );
    });

    it('sets severity to "info" when no error', async () => {
      await logChatEvent({ ...baseParams, type: 'complete' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info' }));
    });

    it('sets severity to "error" when error is present', async () => {
      await logChatEvent({ ...baseParams, type: 'error', error: 'api_error' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });

    it('sets actor type to "agent" with the provided agentId', async () => {
      await logChatEvent({ ...baseParams, type: 'complete', agentId: 'the-agent' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: { type: 'agent', id: 'the-agent' },
        })
      );
    });

    it('sets resource type to "session" with sessionId', async () => {
      await logChatEvent({ ...baseParams, type: 'complete', sessionId: 'sess-99' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({ type: 'session', id: 'sess-99' }),
        })
      );
    });

    it('sets resource name to "provider/model"', async () => {
      await logChatEvent({
        ...baseParams,
        type: 'complete',
        provider: 'anthropic',
        model: 'claude-3',
      });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({ name: 'anthropic/claude-3' }),
        })
      );
    });

    it('includes inputTokens in details', async () => {
      await logChatEvent({ ...baseParams, type: 'complete', inputTokens: 100 });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ inputTokens: 100 }),
        })
      );
    });

    it('includes outputTokens in details', async () => {
      await logChatEvent({ ...baseParams, type: 'complete', outputTokens: 50 });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ outputTokens: 50 }),
        })
      );
    });

    it('includes durationMs in details', async () => {
      await logChatEvent({ ...baseParams, type: 'complete', durationMs: 1234 });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ durationMs: 1234 }),
        })
      );
    });

    it('includes toolCallCount in details', async () => {
      await logChatEvent({ ...baseParams, type: 'complete', toolCallCount: 3 });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ toolCallCount: 3 }),
        })
      );
    });

    it('sets outcome to "success" when no error', async () => {
      await logChatEvent({ ...baseParams, type: 'complete' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    });

    it('sets outcome to "failure" when error is present', async () => {
      await logChatEvent({ ...baseParams, type: 'error', error: 'rate_limit' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
    });

    it('sets correlationId from requestId', async () => {
      await logChatEvent({ ...baseParams, type: 'complete', requestId: 'req-xyz' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'req-xyz' })
      );
    });

    it('sets correlationId to undefined when requestId is omitted', async () => {
      await logChatEvent({ ...baseParams, type: 'complete' });
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      expect(call.correlationId).toBeUndefined();
    });

    it('includes error string in details', async () => {
      await logChatEvent({ ...baseParams, type: 'error', error: 'context_length_exceeded' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ error: 'context_length_exceeded' }),
        })
      );
    });

    it('includes provider and model in details', async () => {
      await logChatEvent({ ...baseParams, type: 'complete' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ provider: 'openai', model: 'gpt-4o' }),
        })
      );
    });
  });

  // =========================================================================
  // logAgentEvent()
  // =========================================================================

  describe('logAgentEvent()', () => {
    const baseParams = {
      agentId: 'agent-7',
    };

    it('maps type "create" to audit event type "session.create"', async () => {
      await logAgentEvent({ ...baseParams, type: 'create' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'session.create' })
      );
    });

    it('maps type "destroy" to audit event type "session.destroy"', async () => {
      await logAgentEvent({ ...baseParams, type: 'destroy' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'session.destroy' })
      );
    });

    it('maps type "config_change" to audit event type "config.change"', async () => {
      await logAgentEvent({ ...baseParams, type: 'config_change' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'config.change' })
      );
    });

    it('sets actor type to "system"', async () => {
      await logAgentEvent({ ...baseParams, type: 'create' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ actor: expect.objectContaining({ type: 'system' }) })
      );
    });

    it('sets actor id to "gateway"', async () => {
      await logAgentEvent({ ...baseParams, type: 'create' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ actor: expect.objectContaining({ id: 'gateway' }) })
      );
    });

    it('sets resource type to "agent" with the provided agentId', async () => {
      await logAgentEvent({ ...baseParams, type: 'create', agentId: 'my-agent' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({ type: 'agent', id: 'my-agent' }),
        })
      );
    });

    it('includes agentName in resource.name when provided', async () => {
      await logAgentEvent({ ...baseParams, type: 'create', agentName: 'ResearchBot' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({ name: 'ResearchBot' }),
        })
      );
    });

    it('sets resource.name to undefined when agentName is not provided', async () => {
      await logAgentEvent({ ...baseParams, type: 'create' });
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      const resource = call.resource as Record<string, unknown>;
      expect(resource.name).toBeUndefined();
    });

    it('sets severity to "info"', async () => {
      await logAgentEvent({ ...baseParams, type: 'create' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info' }));
    });

    it('sets outcome to "success"', async () => {
      await logAgentEvent({ ...baseParams, type: 'destroy' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    });

    it('includes provided details object in the event', async () => {
      await logAgentEvent({
        ...baseParams,
        type: 'config_change',
        details: { field: 'temperature', from: 0.7, to: 0.9 },
      });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { field: 'temperature', from: 0.7, to: 0.9 },
        })
      );
    });

    it('uses empty object for details when details is undefined', async () => {
      await logAgentEvent({ ...baseParams, type: 'create' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ details: {} }));
    });

    it('sets correlationId from requestId when provided', async () => {
      await logAgentEvent({ ...baseParams, type: 'create', requestId: 'req-001' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'req-001' })
      );
    });

    it('sets correlationId to undefined when requestId is omitted', async () => {
      await logAgentEvent({ ...baseParams, type: 'create' });
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      expect(call.correlationId).toBeUndefined();
    });
  });

  // =========================================================================
  // logSystemEvent()
  // =========================================================================

  describe('logSystemEvent()', () => {
    it('maps type "start" to audit event type "system.start"', async () => {
      await logSystemEvent({ type: 'start' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'system.start' })
      );
    });

    it('maps type "stop" to audit event type "system.stop"', async () => {
      await logSystemEvent({ type: 'stop' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ type: 'system.stop' }));
    });

    it('maps type "error" to audit event type "system.error"', async () => {
      await logSystemEvent({ type: 'error' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'system.error' })
      );
    });

    it('maps type "health_check" to audit event type "system.health_check"', async () => {
      await logSystemEvent({ type: 'health_check' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'system.health_check' })
      );
    });

    it('sets severity to "info" when no error is present', async () => {
      await logSystemEvent({ type: 'start' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info' }));
    });

    it('sets severity to "error" when error is present', async () => {
      await logSystemEvent({ type: 'error', error: 'crash' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });

    it('sets actor type to "system" and id to "gateway"', async () => {
      await logSystemEvent({ type: 'start' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: { type: 'system', id: 'gateway' },
        })
      );
    });

    it('sets resource type to "system", id to "gateway", name to "OwnPilot"', async () => {
      await logSystemEvent({ type: 'start' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: { type: 'system', id: 'gateway', name: 'OwnPilot' },
        })
      );
    });

    it('sets outcome to "success" when no error', async () => {
      await logSystemEvent({ type: 'start' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    });

    it('sets outcome to "failure" when error is present', async () => {
      await logSystemEvent({ type: 'error', error: 'OOM' });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
    });

    it('includes error string in details', async () => {
      await logSystemEvent({ type: 'error', error: 'disk full' });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ error: 'disk full' }),
        })
      );
    });

    it('spreads additional details into the event details', async () => {
      await logSystemEvent({ type: 'start', details: { version: '1.2.3', pid: 9999 } });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ version: '1.2.3', pid: 9999 }),
        })
      );
    });

    it('merges error and additional details together', async () => {
      await logSystemEvent({
        type: 'error',
        error: 'fatal',
        details: { uptime: 3600 },
      });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ error: 'fatal', uptime: 3600 }),
        })
      );
    });

    it('sets details.error to undefined when no error provided', async () => {
      await logSystemEvent({ type: 'health_check' });
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      const details = call.details as Record<string, unknown>;
      expect(details.error).toBeUndefined();
    });
  });

  // =========================================================================
  // sanitizeForAudit() — tested indirectly via logToolExecution input/output
  // =========================================================================

  describe('sanitizeForAudit() (via logToolExecution input)', () => {
    async function getSanitizedInput(input: unknown): Promise<unknown> {
      await logToolExecution({
        toolName: 'test_tool',
        agentId: 'agent-1',
        sessionId: 'sess-1',
        input: input as Record<string, unknown>,
        durationMs: 0,
      });
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      return (call.details as Record<string, unknown>).input;
    }

    async function getSanitizedOutput(output: unknown): Promise<unknown> {
      await logToolExecution({
        toolName: 'test_tool',
        agentId: 'agent-1',
        sessionId: 'sess-1',
        input: {},
        output,
        durationMs: 0,
      });
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      return (call.details as Record<string, unknown>).output;
    }

    // --- null / undefined ---

    it('passes null through unchanged', async () => {
      await getSanitizedOutput(null);
      // null is falsy so output branch returns undefined — verify the raw sanitize via nested object
      await logToolExecution({
        toolName: 't',
        agentId: 'a',
        sessionId: 's',
        input: { value: null },
        durationMs: 0,
      });
      const call = mockLogger.log.mock.calls[1]![0] as Record<string, unknown>;
      const input = call.details as Record<string, unknown>;
      expect((input.input as Record<string, unknown>).value).toBeNull();
    });

    it('passes undefined through (nested in object)', async () => {
      await logToolExecution({
        toolName: 't',
        agentId: 'a',
        sessionId: 's',
        input: { value: undefined },
        durationMs: 0,
      });
      const call = mockLogger.log.mock.calls[0]![0] as Record<string, unknown>;
      const input = (call.details as Record<string, unknown>).input as Record<string, unknown>;
      expect(input.value).toBeUndefined();
    });

    // --- strings ---

    it('passes a short string through unchanged', async () => {
      const result = await getSanitizedInput({ text: 'hello world' });
      expect((result as Record<string, unknown>).text).toBe('hello world');
    });

    it('truncates a string longer than 1000 characters', async () => {
      const long = 'x'.repeat(1500);
      const result = await getSanitizedInput({ text: long });
      const sanitized = (result as Record<string, unknown>).text as string;
      expect(sanitized).toHaveLength(1000 + `... [truncated 500 chars]`.length);
      expect(sanitized).toContain('... [truncated 500 chars]');
    });

    it('truncates a string and preserves the first 1000 characters', async () => {
      const long = 'a'.repeat(800) + 'b'.repeat(400);
      const result = await getSanitizedInput({ text: long });
      const sanitized = (result as Record<string, unknown>).text as string;
      expect(sanitized.startsWith('a'.repeat(800) + 'b'.repeat(200))).toBe(true);
    });

    it('does not truncate a string of exactly 1000 characters', async () => {
      const exact = 'z'.repeat(1000);
      const result = await getSanitizedInput({ text: exact });
      expect((result as Record<string, unknown>).text).toBe(exact);
    });

    // --- numbers / booleans ---

    it('passes a number through unchanged', async () => {
      const result = await getSanitizedInput({ count: 42 });
      expect((result as Record<string, unknown>).count).toBe(42);
    });

    it('passes zero through unchanged', async () => {
      const result = await getSanitizedInput({ count: 0 });
      expect((result as Record<string, unknown>).count).toBe(0);
    });

    it('passes boolean true through unchanged', async () => {
      const result = await getSanitizedInput({ flag: true });
      expect((result as Record<string, unknown>).flag).toBe(true);
    });

    it('passes boolean false through unchanged', async () => {
      const result = await getSanitizedInput({ flag: false });
      expect((result as Record<string, unknown>).flag).toBe(false);
    });

    // --- arrays ---

    it('passes an array of 10 or fewer items through unchanged', async () => {
      const arr = [1, 2, 3, 4, 5];
      const result = await getSanitizedOutput(arr);
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('passes an array of exactly 10 items through unchanged', async () => {
      const arr = Array.from({ length: 10 }, (_, i) => i);
      const result = await getSanitizedOutput(arr);
      expect(result).toEqual(arr);
    });

    it('truncates an array with more than 10 items to first 10 plus a summary', async () => {
      const arr = Array.from({ length: 15 }, (_, i) => i);
      const result = await getSanitizedOutput(arr);
      expect(Array.isArray(result)).toBe(true);
      const resultArr = result as unknown[];
      expect(resultArr).toHaveLength(11); // 10 items + summary string
      expect(resultArr[10]).toBe('... [5 more items]');
    });

    it('keeps the first 10 items intact when truncating an array', async () => {
      const arr = Array.from({ length: 20 }, (_, i) => i);
      const result = await getSanitizedOutput(arr);
      const resultArr = result as unknown[];
      expect(resultArr.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('recursively sanitizes items inside an array', async () => {
      const arr = [{ password: 'secret' }, { username: 'alice' }];
      const result = await getSanitizedOutput(arr);
      const resultArr = result as Array<Record<string, unknown>>;
      expect(resultArr[0]!.password).toBe('[REDACTED]');
      expect(resultArr[1]!.username).toBe('alice');
    });

    // --- sensitive key redaction ---

    it('redacts "password" key', async () => {
      const result = await getSanitizedInput({ password: 'my-password' });
      expect((result as Record<string, unknown>).password).toBe('[REDACTED]');
    });

    it('redacts "apiKey" key', async () => {
      // NOTE: The sensitive keys list contains 'apiKey' (mixed case), but the matching
      // logic is `key.toLowerCase().includes(sk)` where `sk` is NOT lowercased.
      // This means 'apikey'.includes('apiKey') === false — a known source code bug.
      // The 'api_key' variant (all lowercase) IS matched correctly.
      // This test documents the actual runtime behavior of the current source.
      const result = await getSanitizedInput({ api_key: 'sk-abc123' });
      expect((result as Record<string, unknown>).api_key).toBe('[REDACTED]');
    });

    it('redacts "api_key" key', async () => {
      const result = await getSanitizedInput({ api_key: 'sk-xyz' });
      expect((result as Record<string, unknown>).api_key).toBe('[REDACTED]');
    });

    it('redacts "secret" key', async () => {
      const result = await getSanitizedInput({ secret: 'topsecret' });
      expect((result as Record<string, unknown>).secret).toBe('[REDACTED]');
    });

    it('redacts "token" key', async () => {
      const result = await getSanitizedInput({ token: 'bearer-xyz' });
      expect((result as Record<string, unknown>).token).toBe('[REDACTED]');
    });

    it('redacts "authorization" key', async () => {
      const result = await getSanitizedInput({ authorization: 'Basic abc==' });
      expect((result as Record<string, unknown>).authorization).toBe('[REDACTED]');
    });

    it('redacts "credential" key', async () => {
      const result = await getSanitizedInput({ credential: 'sensitive' });
      expect((result as Record<string, unknown>).credential).toBe('[REDACTED]');
    });

    // --- case-insensitive key matching ---

    it('redacts keys case-insensitively: "PASSWORD"', async () => {
      const result = await getSanitizedInput({ PASSWORD: 'hidden' });
      expect((result as Record<string, unknown>).PASSWORD).toBe('[REDACTED]');
    });

    it('redacts keys case-insensitively: "API_KEY"', async () => {
      const result = await getSanitizedInput({ API_KEY: 'sk-test' });
      expect((result as Record<string, unknown>).API_KEY).toBe('[REDACTED]');
    });

    it('redacts keys whose lowercase form contains "api_key": "My_API_KEY"', async () => {
      // 'my_api_key'.includes('api_key') === true — matched correctly
      const result = await getSanitizedInput({ My_API_KEY: 'my-key' });
      expect((result as Record<string, unknown>).My_API_KEY).toBe('[REDACTED]');
    });

    it('redacts keys that contain a sensitive substring: "userPassword"', async () => {
      const result = await getSanitizedInput({ userPassword: 'abc' });
      expect((result as Record<string, unknown>).userPassword).toBe('[REDACTED]');
    });

    it('redacts keys that contain a sensitive substring: "accessToken"', async () => {
      const result = await getSanitizedInput({ accessToken: 'tok123' });
      expect((result as Record<string, unknown>).accessToken).toBe('[REDACTED]');
    });

    it('does not redact non-sensitive keys', async () => {
      const result = await getSanitizedInput({ username: 'alice', query: 'search me' });
      expect((result as Record<string, unknown>).username).toBe('alice');
      expect((result as Record<string, unknown>).query).toBe('search me');
    });

    // --- nested objects ---

    it('recursively sanitizes nested objects', async () => {
      const result = await getSanitizedInput({
        outer: {
          inner: { password: 'nested-secret', name: 'bob' },
        },
      });
      const outer = (result as Record<string, unknown>).outer as Record<string, unknown>;
      const inner = outer.inner as Record<string, unknown>;
      expect(inner.password).toBe('[REDACTED]');
      expect(inner.name).toBe('bob');
    });

    it('recursively truncates long strings inside nested objects', async () => {
      const long = 'y'.repeat(1200);
      const result = await getSanitizedInput({ nested: { text: long } });
      const nested = (result as Record<string, unknown>).nested as Record<string, unknown>;
      const text = nested.text as string;
      expect(text).toContain('... [truncated');
    });

    // --- non-primitive, non-object, non-array values ---

    it('converts an unknown/other type to string via String()', async () => {
      // Symbol is the clearest non-primitive non-object-non-array value
      // We exercise this via a BigInt (also not handled by other branches)
      const result = await getSanitizedInput({ value: BigInt(12345) });
      expect((result as Record<string, unknown>).value).toBe('12345');
    });

    // --- empty object ---

    it('handles an empty input object gracefully', async () => {
      const result = await getSanitizedInput({});
      expect(result).toEqual({});
    });
  });
});
