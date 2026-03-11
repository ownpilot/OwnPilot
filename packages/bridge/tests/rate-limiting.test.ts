/**
 * Rate Limiting Tests — per-route rate limit for expensive endpoints
 *
 * RED: These tests FAIL before config.rateLimit is added to routes.ts.
 *      (Global 60/min applies; 3 requests never trigger 429.)
 * GREEN: They PASS after SPAWN_RATE_LIMIT_MAX / ORCH_RATE_LIMIT_MAX per-route
 *        config is added to the respective routes.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mock heavy singletons to prevent actual CC process spawning
// ---------------------------------------------------------------------------

vi.mock('../src/claude-manager.ts', () => ({
  claudeManager: {
    spawn: vi.fn().mockResolvedValue({ conversationId: 'rl-conv', sessionId: 'rl-sess' }),
    resume: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    handback: vi.fn().mockResolvedValue(undefined),
    getProject: vi.fn().mockReturnValue(null),
    getProjectStats: vi.fn().mockReturnValue({ active: 0, paused: 0, total: 0 }),
    listSessions: vi.fn().mockReturnValue([]),
    getSessions: vi.fn().mockReturnValue([]),
    getSession: vi.fn().mockReturnValue(undefined),
    getActiveSessions: vi.fn().mockReturnValue([]),
    getAllSessions: vi.fn().mockReturnValue([]),
    getConversationSession: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock('../src/orchestration-service.ts', () => ({
  orchestrationService: {
    trigger: vi.fn().mockResolvedValue({
      id: 'orch-rl-test',
      status: 'pending',
      stage: 'research',
      projectDir: '/home/ayaz/test-proj',
      message: 'test',
      scope_in: 'src/',
      scope_out: 'vendor/',
      startedAt: new Date().toISOString(),
    }),
    listActive: vi.fn().mockReturnValue([]),
    getById: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../src/gsd-orchestration.ts', () => ({
  gsdOrchestration: {
    trigger: vi.fn().mockResolvedValue({ gsdSessionId: 'gsd-rl', status: 'pending' }),
    listActive: vi.fn().mockReturnValue([]),
    getStatus: vi.fn().mockReturnValue([]),
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks are in place
// ---------------------------------------------------------------------------

import { buildApp, TEST_AUTH_HEADER } from './helpers/build-app.ts';

// ---------------------------------------------------------------------------
// Suite 1: POST /v1/chat/completions — SPAWN_RATE_LIMIT_MAX
// ---------------------------------------------------------------------------

describe('Per-route rate limit — POST /v1/chat/completions', () => {
  let app: FastifyInstance;
  const origSpawnMax = process.env.SPAWN_RATE_LIMIT_MAX;

  beforeAll(async () => {
    process.env.SPAWN_RATE_LIMIT_MAX = '2';
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (origSpawnMax === undefined) {
      delete process.env.SPAWN_RATE_LIMIT_MAX;
    } else {
      process.env.SPAWN_RATE_LIMIT_MAX = origSpawnMax;
    }
  });

  it('allows up to SPAWN_RATE_LIMIT_MAX requests without 429', async () => {
    const payload = JSON.stringify({
      model: 'bridge-model',
      stream: false,
      messages: [{ role: 'user', content: 'rate limit test' }],
    });

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          authorization: TEST_AUTH_HEADER,
          'content-type': 'application/json',
        },
        payload,
      });
      expect(res.statusCode, `request ${i + 1} should not be rate-limited`).not.toBe(429);
    }
  });

  it('returns 429 on the request exceeding SPAWN_RATE_LIMIT_MAX', async () => {
    // This app already has 2 requests consumed (from the previous test in same suite)
    const payload = JSON.stringify({
      model: 'bridge-model',
      stream: false,
      messages: [{ role: 'user', content: 'rate limit test' }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload,
    });
    // RED: fails because no per-route config → global 60/min → 3rd req is not 429
    // GREEN: passes because SPAWN_RATE_LIMIT_MAX=2 per-route → 3rd req is 429
    expect(res.statusCode).toBe(429);
  });

});

// ---------------------------------------------------------------------------
// Suite 2: POST /v1/projects/:dir/orchestrate — ORCH_RATE_LIMIT_MAX
// ---------------------------------------------------------------------------

describe('Per-route rate limit — POST /v1/projects/:dir/orchestrate', () => {
  let app: FastifyInstance;
  const origOrchMax = process.env.ORCH_RATE_LIMIT_MAX;
  const ENCODED_DIR = encodeURIComponent('/home/ayaz/test-proj');

  beforeAll(async () => {
    process.env.ORCH_RATE_LIMIT_MAX = '2';
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (origOrchMax === undefined) {
      delete process.env.ORCH_RATE_LIMIT_MAX;
    } else {
      process.env.ORCH_RATE_LIMIT_MAX = origOrchMax;
    }
  });

  it('allows up to ORCH_RATE_LIMIT_MAX requests without 429', async () => {
    const payload = JSON.stringify({
      message: 'orchestrate this',
      scope_in: 'src/',
      scope_out: 'vendor/',
    });

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/projects/${ENCODED_DIR}/orchestrate`,
        headers: {
          authorization: TEST_AUTH_HEADER,
          'content-type': 'application/json',
        },
        payload,
      });
      expect(res.statusCode, `request ${i + 1} should not be rate-limited`).not.toBe(429);
    }
  });

  it('returns 429 on the request exceeding ORCH_RATE_LIMIT_MAX', async () => {
    const payload = JSON.stringify({
      message: 'orchestrate this',
      scope_in: 'src/',
      scope_out: 'vendor/',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_DIR}/orchestrate`,
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload,
    });
    // RED: fails because no per-route config → global 60/min → 3rd req is not 429
    // GREEN: passes because ORCH_RATE_LIMIT_MAX=2 per-route → 3rd req is 429
    expect(res.statusCode).toBe(429);
  });

});
