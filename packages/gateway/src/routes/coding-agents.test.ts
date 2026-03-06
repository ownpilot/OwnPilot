/**
 * Coding Agents Routes Tests
 *
 * Test suite for the coding agent management endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// ─── Hoisted mocks — safe to reference inside vi.mock() factories ─────────────

const { mockCodingAgentService, mockResultsRepo } = vi.hoisted(() => {
  const mockCodingAgentService = {
    getStatus: vi.fn(),
    runTask: vi.fn(),
    isAvailable: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    terminateSession: vi.fn(),
    writeToSession: vi.fn(),
    getOutputBuffer: vi.fn(),
    resizeSession: vi.fn(),
  };
  const mockResultsRepo = {
    list: vi.fn(),
    count: vi.fn(),
    getById: vi.fn(),
  };
  return { mockCodingAgentService, mockResultsRepo };
});

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../services/coding-agent-service.js', () => ({
  getCodingAgentService: vi.fn(() => mockCodingAgentService),
}));

vi.mock('../db/repositories/coding-agent-results.js', () => ({
  codingAgentResultsRepo: mockResultsRepo,
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { codingAgentsRoutes } from './coding-agents.js';
import { errorHandler } from '../middleware/error-handler.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/coding-agents', codingAgentsRoutes);
  return app;
}

function mockStatus(provider: string, installed = true, configured = true) {
  return {
    provider,
    installed,
    configured,
    available: installed && configured,
    version: '1.0.0',
    ptyAvailable: false,
  };
}

function mockSession(id = 'sess-1', provider = 'claude-code', state = 'running') {
  return {
    id,
    provider,
    state,
    prompt: 'Fix the bug',
    cwd: '/tmp/project',
    userId: 'default',
    createdAt: new Date('2024-01-01'),
  };
}

function mockResult(id = 'result-1') {
  return {
    id,
    userId: 'default',
    provider: 'claude-code',
    prompt: 'Fix the bug',
    success: true,
    output: 'Fixed!',
    durationMs: 5000,
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Coding Agents Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  // ─── GET /status — provider statuses ────────────────────────────────────

  describe('GET /coding-agents/status - List provider statuses', () => {
    it('should return all provider statuses', async () => {
      const statuses = [
        mockStatus('claude-code'),
        mockStatus('codex', false, false),
        mockStatus('gemini-cli', true, false),
      ];
      mockCodingAgentService.getStatus.mockResolvedValue(statuses);

      const res = await app.request('/coding-agents/status');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data).toHaveLength(3);
      expect(data.data[0].provider).toBe('claude-code');
      expect(data.data[0].installed).toBe(true);
    });

    it('should return 500 on service error', async () => {
      mockCodingAgentService.getStatus.mockRejectedValue(new Error('Service unavailable'));

      const res = await app.request('/coding-agents/status');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ─── POST /run — run task ────────────────────────────────────────────────

  describe('POST /coding-agents/run - Run coding task', () => {
    it('should run a task successfully', async () => {
      const taskResult = {
        success: true,
        output: 'Task completed',
        durationMs: 3000,
        provider: 'claude-code',
      };
      mockCodingAgentService.runTask.mockResolvedValue(taskResult);

      const res = await app.request('/coding-agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude-code',
          prompt: 'Fix the failing tests',
          cwd: '/tmp/project',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.output).toBe('Task completed');
    });

    it('should return 422 when task fails', async () => {
      const taskResult = { success: false, output: 'Error occurred', durationMs: 1000 };
      mockCodingAgentService.runTask.mockResolvedValue(taskResult);

      const res = await app.request('/coding-agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-code', prompt: 'Do something' }),
      });

      expect(res.status).toBe(422);
    });

    it('should return 400 when provider is missing', async () => {
      const res = await app.request('/coding-agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Fix the bug' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('provider is required');
    });

    it('should return 400 when prompt is missing', async () => {
      const res = await app.request('/coding-agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-code' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('prompt is required');
    });

    it('should return 400 for invalid provider', async () => {
      const res = await app.request('/coding-agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'invalid-ai', prompt: 'Do stuff' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Invalid provider');
    });

    it('should accept custom: provider', async () => {
      const taskResult = { success: true, output: 'Done', durationMs: 1000 };
      mockCodingAgentService.runTask.mockResolvedValue(taskResult);

      const res = await app.request('/coding-agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'custom:my-agent', prompt: 'Fix bug' }),
      });

      expect(res.status).toBe(200);
    });

    it('should convert timeout_seconds to milliseconds', async () => {
      const taskResult = { success: true, output: 'Done', durationMs: 500 };
      mockCodingAgentService.runTask.mockResolvedValue(taskResult);

      await app.request('/coding-agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-code', prompt: 'Fix bug', timeout_seconds: 60 }),
      });

      expect(mockCodingAgentService.runTask).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 60000 }),
        'default'
      );
    });

    it('should return 500 on service error', async () => {
      mockCodingAgentService.runTask.mockRejectedValue(new Error('Agent crashed'));

      const res = await app.request('/coding-agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-code', prompt: 'Fix bug' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /test — test provider ─────────────────────────────────────────

  describe('POST /coding-agents/test - Test provider connectivity', () => {
    it('should return availability info for a provider', async () => {
      const statuses = [mockStatus('claude-code')];
      mockCodingAgentService.isAvailable.mockResolvedValue(true);
      mockCodingAgentService.getStatus.mockResolvedValue(statuses);

      const res = await app.request('/coding-agents/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-code' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.provider).toBe('claude-code');
      expect(data.data.available).toBe(true);
      expect(data.data.installed).toBe(true);
    });

    it('should return 400 when provider is missing', async () => {
      const res = await app.request('/coding-agents/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('provider is required');
    });

    it('should return 400 for invalid provider', async () => {
      const res = await app.request('/coding-agents/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'not-real' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Invalid provider');
    });
  });

  // ─── GET /sessions — list sessions ──────────────────────────────────────

  describe('GET /coding-agents/sessions - List sessions', () => {
    it('should return active sessions for user', async () => {
      const sessions = [mockSession('sess-1'), mockSession('sess-2')];
      mockCodingAgentService.listSessions.mockReturnValue(sessions);

      const res = await app.request('/coding-agents/sessions');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data[0].id).toBe('sess-1');
      expect(mockCodingAgentService.listSessions).toHaveBeenCalledWith('default');
    });

    it('should return empty array when no sessions', async () => {
      mockCodingAgentService.listSessions.mockReturnValue([]);

      const res = await app.request('/coding-agents/sessions');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
    });
  });

  // ─── POST /sessions — create session ────────────────────────────────────

  describe('POST /coding-agents/sessions - Create session', () => {
    it('should create a PTY session', async () => {
      const session = mockSession('sess-new');
      mockCodingAgentService.createSession.mockResolvedValue(session);

      const res = await app.request('/coding-agents/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude-code',
          prompt: 'Help me debug',
          cwd: '/tmp',
          mode: 'auto',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('sess-new');
    });

    it('should return 400 for missing provider', async () => {
      const res = await app.request('/coding-agents/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Help me' }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for missing prompt', async () => {
      const res = await app.request('/coding-agents/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-code' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('prompt is required');
    });

    it('should return 400 for invalid mode', async () => {
      const res = await app.request('/coding-agents/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-code', prompt: 'Help', mode: 'invalid-mode' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('mode must be');
    });

    it('should return 409 when max sessions reached', async () => {
      mockCodingAgentService.createSession.mockRejectedValue(new Error('Maximum sessions reached'));

      const res = await app.request('/coding-agents/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-code', prompt: 'Help' }),
      });

      expect(res.status).toBe(409);
    });

    it('should return 422 when provider not installed', async () => {
      mockCodingAgentService.createSession.mockRejectedValue(new Error('claude not installed'));

      const res = await app.request('/coding-agents/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-code', prompt: 'Help' }),
      });

      expect(res.status).toBe(422);
    });
  });

  // ─── GET /sessions/:id — get session ────────────────────────────────────

  describe('GET /coding-agents/sessions/:id - Get session', () => {
    it('should return session when found', async () => {
      const session = mockSession('sess-1');
      mockCodingAgentService.getSession.mockReturnValue(session);

      const res = await app.request('/coding-agents/sessions/sess-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('sess-1');
      expect(mockCodingAgentService.getSession).toHaveBeenCalledWith('sess-1', 'default');
    });

    it('should return 404 when session not found', async () => {
      mockCodingAgentService.getSession.mockReturnValue(null);

      const res = await app.request('/coding-agents/sessions/nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Session not found');
    });
  });

  // ─── DELETE /sessions/:id — terminate session ────────────────────────────

  describe('DELETE /coding-agents/sessions/:id - Terminate session', () => {
    it('should terminate session successfully', async () => {
      mockCodingAgentService.terminateSession.mockReturnValue(true);

      const res = await app.request('/coding-agents/sessions/sess-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.terminated).toBe(true);
      expect(mockCodingAgentService.terminateSession).toHaveBeenCalledWith('sess-1', 'default');
    });

    it('should return 404 when session not found', async () => {
      mockCodingAgentService.terminateSession.mockReturnValue(false);

      const res = await app.request('/coding-agents/sessions/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.message).toContain('Session not found');
    });
  });

  // ─── POST /sessions/:id/input — send input ──────────────────────────────

  describe('POST /coding-agents/sessions/:id/input - Send input', () => {
    it('should send input to session', async () => {
      mockCodingAgentService.writeToSession.mockReturnValue(true);

      const res = await app.request('/coding-agents/sessions/sess-1/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'y\n' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.sent).toBe(true);
      expect(mockCodingAgentService.writeToSession).toHaveBeenCalledWith(
        'sess-1',
        'default',
        'y\n'
      );
    });

    it('should return 400 when data field is missing', async () => {
      const res = await app.request('/coding-agents/sessions/sess-1/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ other: 'value' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('"data" string is required');
    });

    it('should return 404 when session not found or not running', async () => {
      mockCodingAgentService.writeToSession.mockReturnValue(false);

      const res = await app.request('/coding-agents/sessions/sess-1/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'hello' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /sessions/:id/output — get output ──────────────────────────────

  describe('GET /coding-agents/sessions/:id/output - Get output buffer', () => {
    it('should return session output', async () => {
      const session = mockSession('sess-1');
      mockCodingAgentService.getSession.mockReturnValue(session);
      mockCodingAgentService.getOutputBuffer.mockReturnValue('Some output text\n');

      const res = await app.request('/coding-agents/sessions/sess-1/output');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.sessionId).toBe('sess-1');
      expect(data.data.output).toBe('Some output text\n');
      expect(data.data.hasOutput).toBe(true);
    });

    it('should return empty output when buffer is null', async () => {
      const session = mockSession('sess-1', 'claude-code', 'idle');
      mockCodingAgentService.getSession.mockReturnValue(session);
      mockCodingAgentService.getOutputBuffer.mockReturnValue(null);

      const res = await app.request('/coding-agents/sessions/sess-1/output');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.output).toBe('');
      expect(data.data.hasOutput).toBe(false);
    });

    it('should return 404 when session not found', async () => {
      mockCodingAgentService.getSession.mockReturnValue(null);

      const res = await app.request('/coding-agents/sessions/nonexistent/output');

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /sessions/:id/resize — resize terminal ────────────────────────

  describe('POST /coding-agents/sessions/:id/resize - Resize terminal', () => {
    it('should resize terminal successfully', async () => {
      mockCodingAgentService.resizeSession.mockReturnValue(true);

      const res = await app.request('/coding-agents/sessions/sess-1/resize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 120, rows: 40 }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.resized).toBe(true);
      expect(mockCodingAgentService.resizeSession).toHaveBeenCalledWith(
        'sess-1',
        'default',
        120,
        40
      );
    });

    it('should return 400 for zero cols', async () => {
      const res = await app.request('/coding-agents/sessions/sess-1/resize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 0, rows: 40 }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('"cols" and "rows" must be positive numbers');
    });

    it('should return 400 when cols is not a number', async () => {
      const res = await app.request('/coding-agents/sessions/sess-1/resize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 'wide', rows: 40 }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 404 when session not found', async () => {
      mockCodingAgentService.resizeSession.mockReturnValue(false);

      const res = await app.request('/coding-agents/sessions/sess-1/resize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /results — list results ────────────────────────────────────────

  describe('GET /coding-agents/results - List results', () => {
    it('should return paginated results', async () => {
      const results = [mockResult('result-1'), mockResult('result-2')];
      mockResultsRepo.list.mockResolvedValue(results);
      mockResultsRepo.count.mockResolvedValue(2);

      const res = await app.request('/coding-agents/results');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.data).toHaveLength(2);
      expect(data.data.pagination.total).toBe(2);
      expect(data.data.pagination.limit).toBe(20);
    });

    it('should return empty results', async () => {
      mockResultsRepo.list.mockResolvedValue([]);
      mockResultsRepo.count.mockResolvedValue(0);

      const res = await app.request('/coding-agents/results');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.data).toEqual([]);
      expect(data.data.pagination.total).toBe(0);
    });

    it('should return 500 on database error', async () => {
      mockResultsRepo.list.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/coding-agents/results');

      expect(res.status).toBe(500);
    });
  });

  // ─── GET /results/:id — single result ───────────────────────────────────

  describe('GET /coding-agents/results/:id - Get single result', () => {
    it('should return result when found', async () => {
      const result = mockResult('result-1');
      mockResultsRepo.getById.mockResolvedValue(result);

      const res = await app.request('/coding-agents/results/result-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('result-1');
      expect(data.data.provider).toBe('claude-code');
    });

    it('should return 404 when result not found', async () => {
      mockResultsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/coding-agents/results/nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Result not found');
    });

    it('should return 500 on database error', async () => {
      mockResultsRepo.getById.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/coding-agents/results/result-1');

      expect(res.status).toBe(500);
    });
  });
});
