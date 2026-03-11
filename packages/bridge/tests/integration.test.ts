import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, TEST_AUTH_HEADER } from './helpers/build-app.ts';
import { claudeManager } from '../src/claude-manager.ts';
import { webhookStore } from '../src/webhook-store.ts';

/**
 * Integration tests — real HTTP requests via fastify.inject().
 * Tests auth guards, endpoint responses, path traversal, and request validation.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

// ---- Ping (no auth) ----

describe('GET /ping', () => {
  it('returns 200 with pong', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pong).toBe(true);
    expect(body.timestamp).toBeDefined();
  });

  it('works without auth header', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
  });
});

// ---- Health (auth required) ----

describe('GET /health', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.message).toContain('Missing Bearer token');
  });

  it('returns 401 with wrong token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.message).toContain('Invalid API key');
  });

  it('returns 200 with valid auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.circuitBreaker).toBeDefined();
    expect(body.sessions).toBeInstanceOf(Array);
    expect(typeof body.totalSessions).toBe('number');
  });
});

// ---- Version (auth required) ----

describe('GET /version', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/version' });
    expect(res.statusCode).toBe(401);
  });

  it('returns version info with auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/version',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe('1.0.0');
    expect(typeof body.uptime).toBe('number');
    expect(body.model).toBeDefined();
    expect(body.startedAt).toBeDefined();
  });
});

// ---- Models (auth required) ----

describe('GET /v1/models', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/models' });
    expect(res.statusCode).toBe(401);
  });

  it('returns model list with auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.object).toBe('list');
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].owned_by).toBe('anthropic');
  });
});

// ---- Metrics (auth required) ----

describe('GET /metrics', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(401);
  });

  it('returns metrics with auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.spawnCount).toBe('number');
    expect(typeof body.activeSessions).toBe('number');
  });
});

// ---- Status (auth required) ----

describe('GET /status', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/status' });
    expect(res.statusCode).toBe(401);
  });

  it('returns status summary with auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/status',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions).toBeDefined();
    expect(typeof body.sessions.active).toBe('number');
    expect(body.circuitBreaker).toBeDefined();
    expect(body.performance).toBeDefined();
  });
});

// ---- Chat completions validation ----

describe('POST /v1/chat/completions', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 with empty messages array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.message).toContain('messages array is required');
  });

  it('returns 400 with missing messages field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { model: 'test' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('blocks path traversal via X-Project-Dir header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
        'x-project-dir': '/etc/passwd',
      },
      payload: { messages: [{ role: 'user', content: 'test' }] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('PATH_TRAVERSAL_BLOCKED');
  });

  it('blocks dotfile directory under home', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
        'x-project-dir': '/home/ayaz/.ssh',
      },
      payload: { messages: [{ role: 'user', content: 'test' }] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('PATH_TRAVERSAL_BLOCKED');
  });

  it('blocks directory traversal with ../', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
        'x-project-dir': '/home/ayaz/../../etc',
      },
      payload: { messages: [{ role: 'user', content: 'test' }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---- Sessions disk (auth required) ----

describe('GET /v1/sessions/disk', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions/disk' });
    expect(res.statusCode).toBe(401);
  });

  it('returns session list with auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/disk',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions).toBeInstanceOf(Array);
    expect(typeof body.total).toBe('number');
  });
});

// ---- Session operations (404 for non-existent sessions) ----

describe('POST /v1/sessions/:id/pause', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/nonexistent/pause',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for non-existent session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/nonexistent-id/pause',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /v1/sessions/:id/handback', () => {
  it('returns 404 for non-existent session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/nonexistent-id/handback',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /v1/sessions/:conversationId', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/some-id',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for non-existent session', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/nonexistent-conv',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---- GET /v1/sessions/pending ----

describe('GET /v1/sessions/pending', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions/pending' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty pending list when no sessions are pending', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/pending',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pending).toBeInstanceOf(Array);
    expect(body.pending.length).toBe(0);
  });

  it('returns pending sessions when approval is set', async () => {
    // Create a session and set pending approval
    await claudeManager.getOrCreate('test-pending-conv');
    claudeManager.setPendingApproval('test-pending-conv', 'QUESTION', 'Which database?');

    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/pending',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pending.length).toBeGreaterThanOrEqual(1);

    const found = body.pending.find((p: { conversationId: string }) => p.conversationId === 'test-pending-conv');
    expect(found).toBeDefined();
    expect(found.pattern).toBe('QUESTION');
    expect(found.text).toBe('Which database?');
    expect(typeof found.detectedAt).toBe('number');
    expect(typeof found.waitingFor).toBe('string');

    // Cleanup
    claudeManager.terminate('test-pending-conv');
  });
});

// ---- POST /v1/sessions/:id/respond ----

describe('POST /v1/sessions/:id/respond', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/some-id/respond',
      payload: { message: 'test' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for non-existent session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/nonexistent/respond',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { message: 'answer' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.type).toBe('not_found');
  });

  it('returns 409 when session is not pending', async () => {
    await claudeManager.getOrCreate('test-respond-no-pending');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/test-respond-no-pending/respond',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { message: 'answer' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.type).toBe('conflict');

    // Cleanup
    claudeManager.terminate('test-respond-no-pending');
  });

  it('returns 400 with empty message', async () => {
    await claudeManager.getOrCreate('test-respond-empty');
    claudeManager.setPendingApproval('test-respond-empty', 'QUESTION', 'Q?');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/test-respond-empty/respond',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);

    // Cleanup
    claudeManager.terminate('test-respond-empty');
  });

  it('returns 400 with missing message field', async () => {
    await claudeManager.getOrCreate('test-respond-missing');
    claudeManager.setPendingApproval('test-respond-missing', 'QUESTION', 'Q?');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/test-respond-missing/respond',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(400);

    // Cleanup
    claudeManager.terminate('test-respond-missing');
  });
});

// ---- POST /v1/webhooks ----

describe('POST /v1/webhooks', () => {
  afterEach(() => {
    webhookStore.clear();
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      payload: { url: 'https://example.com/hook' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('registers a webhook and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { url: 'https://example.com/hook' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.url).toBe('https://example.com/hook');
    expect(body.events).toEqual(['blocking']);
    expect(body.secret).toBeNull();
  });

  it('registers with secret and custom events', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { url: 'https://example.com/hook', secret: 'my-key', events: ['blocking'] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.secret).toBe('my-key');
  });

  it('returns 400 for missing URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { url: 'not-a-url' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for duplicate URL', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { url: 'https://example.com/hook' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { url: 'https://example.com/hook' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---- GET /v1/webhooks ----

describe('GET /v1/webhooks', () => {
  afterEach(() => {
    webhookStore.clear();
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/webhooks',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty list initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/webhooks',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.webhooks).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('lists registered webhooks without exposing secret', async () => {
    webhookStore.register({ url: 'https://a.com/hook', secret: 'secret-key' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/webhooks',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.webhooks[0].url).toBe('https://a.com/hook');
    expect(body.webhooks[0].hasSecret).toBe(true);
    expect(body.webhooks[0].secret).toBeUndefined(); // secret NOT exposed
  });
});

// ---- DELETE /v1/webhooks/:id ----

describe('DELETE /v1/webhooks/:id', () => {
  afterEach(() => {
    webhookStore.clear();
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/webhooks/some-id',
    });
    expect(res.statusCode).toBe(401);
  });

  it('deletes existing webhook and returns 204', async () => {
    const wh = webhookStore.register({ url: 'https://a.com/hook' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/webhooks/${wh.id}`,
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(204);
    expect(webhookStore.size).toBe(0);
  });

  it('returns 404 for unknown webhook', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/webhooks/nonexistent',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---- Auth edge cases ----

describe('auth edge cases', () => {
  it('rejects Basic auth scheme', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects empty Bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: 'Bearer ' },
    });
    expect(res.statusCode).toBe(401);
  });
});
