import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerRoutes } from '../src/api/routes.ts';
import { claudeManager } from '../src/claude-manager.ts';
import { config } from '../src/config.ts';

/**
 * Integration tests for Phase 4b interactive session HTTP endpoints.
 * Uses Fastify inject() with claudeManager methods spied/mocked.
 */

const AUTH_HEADER = `Bearer ${config.bridgeApiKey}`;

describe('Interactive Session Endpoints (Phase 4b)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await registerRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  // =========================================================================
  // POST /v1/sessions/start-interactive
  // =========================================================================

  describe('POST /v1/sessions/start-interactive', () => {
    it('returns 200 with session info on success', async () => {
      vi.spyOn(claudeManager, 'startInteractive').mockResolvedValue({
        conversationId: 'test-conv',
        sessionId: 'test-uuid',
        pid: 12345,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/start-interactive',
        headers: { authorization: AUTH_HEADER },
        payload: { project_dir: '/tmp/test' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('interactive');
      expect(body.conversationId).toBe('test-conv');
      expect(body.sessionId).toBe('test-uuid');
      expect(body.pid).toBe(12345);
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/start-interactive',
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/start-interactive',
        headers: { authorization: 'Bearer wrong-token' },
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for disallowed project_dir (path traversal)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/start-interactive',
        headers: { authorization: AUTH_HEADER },
        payload: { project_dir: '/etc/passwd' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain('allowed directories');
    });

    it('returns 400 for hidden directory under home', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/start-interactive',
        headers: { authorization: AUTH_HEADER },
        payload: { project_dir: '/home/ayaz/.ssh' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 429 when too many interactive sessions', async () => {
      vi.spyOn(claudeManager, 'startInteractive').mockRejectedValue(
        new Error('Too many interactive sessions (3/3). Close one first.'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/start-interactive',
        headers: { authorization: AUTH_HEADER },
        payload: { project_dir: '/tmp/test' },
      });
      expect(res.statusCode).toBe(429);
      expect(res.json().error.type).toBe('rate_limit_error');
    });

    it('returns 409 for conflict errors (already interactive)', async () => {
      vi.spyOn(claudeManager, 'startInteractive').mockRejectedValue(
        new Error('Session already has an interactive process (PID 123)'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/start-interactive',
        headers: { authorization: AUTH_HEADER },
        payload: { project_dir: '/tmp/test' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.type).toBe('conflict');
    });

    it('uses X-Conversation-Id header when provided', async () => {
      const spy = vi.spyOn(claudeManager, 'startInteractive').mockResolvedValue({
        conversationId: 'my-custom-conv',
        sessionId: 'uuid',
        pid: 111,
      });

      await app.inject({
        method: 'POST',
        url: '/v1/sessions/start-interactive',
        headers: {
          authorization: AUTH_HEADER,
          'x-conversation-id': 'my-custom-conv',
        },
        payload: { project_dir: '/tmp/test' },
      });

      expect(spy).toHaveBeenCalledWith(
        'my-custom-conv',
        expect.objectContaining({ projectDir: expect.stringContaining('/tmp/') }),
      );
    });

    it('passes system_prompt and max_turns to claudeManager', async () => {
      const spy = vi.spyOn(claudeManager, 'startInteractive').mockResolvedValue({
        conversationId: 'conv',
        sessionId: 'uuid',
        pid: 222,
      });

      await app.inject({
        method: 'POST',
        url: '/v1/sessions/start-interactive',
        headers: { authorization: AUTH_HEADER },
        payload: { project_dir: '/tmp/test', system_prompt: 'Be helpful', max_turns: 5 },
      });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ systemPrompt: 'Be helpful', maxTurns: 5 }),
      );
    });
  });

  // =========================================================================
  // POST /v1/sessions/:id/input
  // =========================================================================

  describe('POST /v1/sessions/:id/input', () => {
    it('returns 200 on successful write', async () => {
      vi.spyOn(claudeManager, 'getSession').mockReturnValue({
        conversationId: 'conv-input',
        sessionId: 'uuid-input',
        processAlive: true,
        lastActivity: new Date(),
        projectDir: '/tmp',
        tokensUsed: 0,
        budgetUsed: 0,
        pendingApproval: null,
      });
      vi.spyOn(claudeManager, 'isInteractive').mockReturnValue(true);
      vi.spyOn(claudeManager, 'writeToSession').mockReturnValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/conv-input/input',
        headers: { authorization: AUTH_HEADER },
        payload: { message: 'Hello from test' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('sent');
      expect(body.conversationId).toBe('conv-input');
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/conv-1/input',
        payload: { message: 'test' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for empty message', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/conv-1/input',
        headers: { authorization: AUTH_HEADER },
        payload: { message: '' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain('message is required');
    });

    it('returns 400 for missing message', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/conv-1/input',
        headers: { authorization: AUTH_HEADER },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent session', async () => {
      vi.spyOn(claudeManager, 'getSession').mockReturnValue(null);
      vi.spyOn(claudeManager, 'findBySessionId').mockReturnValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/nonexistent/input',
        headers: { authorization: AUTH_HEADER },
        payload: { message: 'test' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.type).toBe('not_found');
    });

    it('returns 409 when session is not in interactive mode', async () => {
      vi.spyOn(claudeManager, 'getSession').mockReturnValue({
        conversationId: 'conv-noint',
        sessionId: 'uuid',
        processAlive: false,
        lastActivity: new Date(),
        projectDir: '/tmp',
        tokensUsed: 0,
        budgetUsed: 0,
        pendingApproval: null,
      });
      vi.spyOn(claudeManager, 'isInteractive').mockReturnValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/conv-noint/input',
        headers: { authorization: AUTH_HEADER },
        payload: { message: 'test' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.type).toBe('conflict');
      expect(res.json().error.message).toContain('not in interactive mode');
    });

    it('returns 500 when writeToSession fails', async () => {
      vi.spyOn(claudeManager, 'getSession').mockReturnValue({
        conversationId: 'conv-fail',
        sessionId: 'uuid',
        processAlive: true,
        lastActivity: new Date(),
        projectDir: '/tmp',
        tokensUsed: 0,
        budgetUsed: 0,
        pendingApproval: null,
      });
      vi.spyOn(claudeManager, 'isInteractive').mockReturnValue(true);
      vi.spyOn(claudeManager, 'writeToSession').mockReturnValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/conv-fail/input',
        headers: { authorization: AUTH_HEADER },
        payload: { message: 'test' },
      });
      expect(res.statusCode).toBe(500);
    });

    it('resolves session by sessionId (UUID) via findBySessionId', async () => {
      vi.spyOn(claudeManager, 'getSession')
        .mockReturnValueOnce(null) // first check fails (id is UUID, not convId)
        .mockReturnValue({
          conversationId: 'real-conv',
          sessionId: 'some-uuid',
          processAlive: true,
          lastActivity: new Date(),
          projectDir: '/tmp',
          tokensUsed: 0,
          budgetUsed: 0,
          pendingApproval: null,
        });
      vi.spyOn(claudeManager, 'findBySessionId').mockReturnValue('real-conv');
      vi.spyOn(claudeManager, 'isInteractive').mockReturnValue(true);
      vi.spyOn(claudeManager, 'writeToSession').mockReturnValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/some-uuid/input',
        headers: { authorization: AUTH_HEADER },
        payload: { message: 'found via UUID' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().conversationId).toBe('real-conv');
    });
  });

  // =========================================================================
  // POST /v1/sessions/:id/close-interactive
  // =========================================================================

  describe('POST /v1/sessions/:id/close-interactive', () => {
    it('returns 200 on successful close', async () => {
      vi.spyOn(claudeManager, 'getSession').mockReturnValue({
        conversationId: 'conv-close',
        sessionId: 'uuid',
        processAlive: true,
        lastActivity: new Date(),
        projectDir: '/tmp',
        tokensUsed: 0,
        budgetUsed: 0,
        pendingApproval: null,
      });
      vi.spyOn(claudeManager, 'isInteractive').mockReturnValue(true);
      vi.spyOn(claudeManager, 'closeInteractive').mockResolvedValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/conv-close/close-interactive',
        headers: { authorization: AUTH_HEADER },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('closed');
      expect(body.conversationId).toBe('conv-close');
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/conv-1/close-interactive',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for non-existent session', async () => {
      vi.spyOn(claudeManager, 'getSession').mockReturnValue(null);
      vi.spyOn(claudeManager, 'findBySessionId').mockReturnValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/nonexistent/close-interactive',
        headers: { authorization: AUTH_HEADER },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 409 when session is not in interactive mode', async () => {
      vi.spyOn(claudeManager, 'getSession').mockReturnValue({
        conversationId: 'conv-noint',
        sessionId: 'uuid',
        processAlive: false,
        lastActivity: new Date(),
        projectDir: '/tmp',
        tokensUsed: 0,
        budgetUsed: 0,
        pendingApproval: null,
      });
      vi.spyOn(claudeManager, 'isInteractive').mockReturnValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/conv-noint/close-interactive',
        headers: { authorization: AUTH_HEADER },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toContain('not in interactive mode');
    });

    it('returns 500 when closeInteractive fails', async () => {
      vi.spyOn(claudeManager, 'getSession').mockReturnValue({
        conversationId: 'conv-cfail',
        sessionId: 'uuid',
        processAlive: true,
        lastActivity: new Date(),
        projectDir: '/tmp',
        tokensUsed: 0,
        budgetUsed: 0,
        pendingApproval: null,
      });
      vi.spyOn(claudeManager, 'isInteractive').mockReturnValue(true);
      vi.spyOn(claudeManager, 'closeInteractive').mockResolvedValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/conv-cfail/close-interactive',
        headers: { authorization: AUTH_HEADER },
      });
      expect(res.statusCode).toBe(500);
    });

    it('resolves session by sessionId (UUID) via findBySessionId', async () => {
      vi.spyOn(claudeManager, 'getSession')
        .mockReturnValueOnce(null)
        .mockReturnValue({
          conversationId: 'real-conv',
          sessionId: 'sess-uuid',
          processAlive: true,
          lastActivity: new Date(),
          projectDir: '/tmp',
          tokensUsed: 0,
          budgetUsed: 0,
          pendingApproval: null,
        });
      vi.spyOn(claudeManager, 'findBySessionId').mockReturnValue('real-conv');
      vi.spyOn(claudeManager, 'isInteractive').mockReturnValue(true);
      vi.spyOn(claudeManager, 'closeInteractive').mockResolvedValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions/sess-uuid/close-interactive',
        headers: { authorization: AUTH_HEADER },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().conversationId).toBe('real-conv');
    });
  });
});
