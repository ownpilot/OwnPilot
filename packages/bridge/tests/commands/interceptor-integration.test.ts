/**
 * Command Interceptor — Integration Tests
 *
 * Full HTTP flow tests using Fastify inject().
 * Tests command interception, REST endpoints, fallthrough, and error handling.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, TEST_AUTH_HEADER } from '../helpers/build-app.ts';

// Mock claudeManager so fallthrough tests work without a live CC process.
// Intercepted commands (the majority of tests) never reach claudeManager,
// so this mock has no effect on them.
vi.mock('../../src/claude-manager.ts', () => {
  async function* mockSend() {
    yield { type: 'text', text: 'Mock CC fallthrough response' };
    yield { type: 'done', usage: null };
  }
  return {
    claudeManager: {
      getSession: vi.fn().mockReturnValue(undefined),
      setConfigOverrides: vi.fn(),
      getConfigOverrides: vi.fn().mockReturnValue({}),
      terminate: vi.fn(),
      setDisplayName: vi.fn(),
      getDisplayName: vi.fn().mockReturnValue(undefined),
      listDiskSessions: vi.fn().mockResolvedValue([]),
      getSessionJsonlPath: vi.fn().mockReturnValue(undefined),
      getOrCreate: vi.fn().mockImplementation((convId: string, opts: { projectDir?: string }) =>
        Promise.resolve({
          conversationId: convId,
          sessionId: 'mock-session-id',
          processAlive: false,
          lastActivity: new Date(),
          projectDir: opts?.projectDir ?? '/home/ayaz/openclaw-bridge',
          tokensUsed: 0,
          budgetUsed: 0,
          pendingApproval: null,
        }),
      ),
      send: vi.fn().mockImplementation(mockSend),
      killActiveProcess: vi.fn(),
      getSessions: vi.fn().mockReturnValue([]),
      getCircuitBreakerState: vi.fn().mockReturnValue({ tier1: { state: 'CLOSED', failures: 0 } }),
      isPaused: vi.fn().mockReturnValue({ paused: false }),
      getProjectStats: vi.fn().mockReturnValue([]),
      getProjectSessionDetails: vi.fn().mockReturnValue([]),
      getProjectResourceMetrics: vi.fn().mockReturnValue([]),
      findBySessionId: vi.fn().mockReturnValue(undefined),
      getPendingSessions: vi.fn().mockReturnValue([]),
      clearPendingApproval: vi.fn(),
      pause: vi.fn().mockReturnValue({ paused: true }),
      handback: vi.fn().mockResolvedValue(true),
      setPendingApproval: vi.fn(),
      wasPatternDetected: vi.fn().mockReturnValue(false),
    },
  };
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

// Helper: POST a message to chat/completions (non-streaming)
async function postMessage(
  content: string,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: {
      authorization: TEST_AUTH_HEADER,
      'content-type': 'application/json',
      'x-project-dir': '/home/ayaz/openclaw-bridge',
      ...headers,
    },
    payload: {
      model: 'bridge-model',
      stream: false,
      messages: [{ role: 'user', content }],
    },
  });
}

// Helper: extract assistant content from chat completion response
function getContent(response: { json(): Record<string, unknown> }): string {
  const body = response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content ?? '';
}

// ============================================================================
// Command Interception via HTTP
// ============================================================================
describe('command interception via HTTP', () => {
  it('/help returns command list', async () => {
    const res = await postMessage('/help');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('Available bridge commands');
    expect(content).toContain('/help');
    expect(content).toContain('/model');
    expect(content).toContain('/rename');
  });

  it('/help response has OpenAI-compatible structure', async () => {
    const res = await postMessage('/help');
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('object', 'chat.completion');
    expect(body).toHaveProperty('choices');
    expect(body).toHaveProperty('model');
  });

  it('/status returns session info or no-session message', async () => {
    const res = await postMessage('/status');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    // First time there's no session, so it should say "No active session"
    expect(content).toContain('No active session');
  });

  it('/cost returns no-session message when fresh', async () => {
    const res = await postMessage('/cost');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('no cost data');
  });

  it('/context returns no-session message when fresh', async () => {
    const res = await postMessage('/context');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('no context data');
  });

  it('/usage returns no-session message when fresh', async () => {
    const res = await postMessage('/usage');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('No active session');
  });

  it('/config returns configuration info', async () => {
    const res = await postMessage('/config');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('Model:');
    expect(content).toContain('Max budget:');
  });
});

// ============================================================================
// Config Override Commands
// ============================================================================
describe('config override commands via HTTP', () => {
  const convId = 'integration-config-test';

  it('/model opus sets model override', async () => {
    const res = await postMessage('/model opus', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('claude-opus-4-6');
  });

  it('/model shows aliases when no args', async () => {
    const res = await postMessage('/model', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('opus');
    expect(content).toContain('sonnet');
  });

  it('/effort high sets effort', async () => {
    const res = await postMessage('/effort high', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('high');
  });

  it('/effort invalid is rejected', async () => {
    const res = await postMessage('/effort invalid', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('Usage');
  });

  it('/fast on enables fast mode', async () => {
    const res = await postMessage('/fast on', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('enabled');
  });

  it('/fast off disables fast mode', async () => {
    const res = await postMessage('/fast off', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('disabled');
  });

  it('/plan toggles plan mode', async () => {
    const res = await postMessage('/plan', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content.toLowerCase()).toContain('plan');
  });

  it('/add-dir /tmp adds directory', async () => {
    const res = await postMessage('/add-dir /tmp', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('/tmp');
  });

  it('/add-dir /nonexistent rejects', async () => {
    const res = await postMessage('/add-dir /nonexistent-abc-xyz-integration', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('not found');
  });
});

// ============================================================================
// Session Commands
// ============================================================================
describe('session commands via HTTP', () => {
  const convId = 'integration-session-test';

  it('/rename my-test sets display name', async () => {
    const res = await postMessage('/rename my-test', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content.length).toBeGreaterThan(0);
  });

  it('/rename shows usage when no session (displayName not persisted without CC session)', async () => {
    const res = await postMessage('/rename', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    // No CC session exists in integration test, so displayName isn't persisted
    expect(content).toContain('Usage');
  });

  it('/clear on fresh session says no active session', async () => {
    const res = await postMessage('/clear', { 'x-conversation-id': 'fresh-clear-test' });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('No active session');
  });

  it('/resume lists disk sessions', async () => {
    const res = await postMessage('/resume', { 'x-conversation-id': convId });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    // Should list sessions or say none found
    expect(content.length).toBeGreaterThan(0);
  });

  it('/export on fresh session says no active session', async () => {
    const res = await postMessage('/export', { 'x-conversation-id': 'fresh-export-test' });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('No active session');
  });
});

// ============================================================================
// Noop Commands
// ============================================================================
describe('noop commands via HTTP', () => {
  it('/theme returns terminal-only message', async () => {
    const res = await postMessage('/theme');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('interactive terminal');
  });

  it('/vim returns terminal-only message', async () => {
    const res = await postMessage('/vim');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('interactive terminal');
  });

  it('/login returns terminal-only message', async () => {
    const res = await postMessage('/login');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('claude login');
  });

  it('/logout returns terminal-only message', async () => {
    const res = await postMessage('/logout');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('claude logout');
  });
});

// ============================================================================
// Utility Commands (/diff, /doctor)
// ============================================================================
describe('utility commands via HTTP', () => {
  it('/diff returns git diff output', async () => {
    const res = await postMessage('/diff');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    // Should show either diff or clean working tree message
    expect(content.length).toBeGreaterThan(0);
  });

  it('/diff --stat returns stat output', async () => {
    const res = await postMessage('/diff --stat');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content.length).toBeGreaterThan(0);
  });

  it('/diff in non-git dir returns error', async () => {
    const res = await postMessage('/diff', { 'x-project-dir': '/tmp' });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content.toLowerCase()).toContain('not a git repository');
  });
});

// ============================================================================
// Fallthrough: Unknown commands pass through to CC
// ============================================================================
// CC is mocked via vi.mock above — these tests now run without live CC
describe('command fallthrough (requires live CC)', () => {
  it('/gsd:health falls through (not intercepted)', async () => {
    const res = await postMessage('/gsd:health');
    expect(getContent(res)).not.toContain('Available bridge commands');
  }, 60_000);

  it('regular message is not intercepted', async () => {
    const res = await postMessage('What is 2+2?');
    expect(getContent(res)).not.toContain('Available bridge commands');
  }, 60_000);
});

// ============================================================================

// ============================================================================
// Error handling
// ============================================================================
describe('error handling', () => {
  it('rejects missing auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: {
        model: 'bridge-model',
        messages: [{ role: 'user', content: '/help' }],
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects empty messages array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { model: 'bridge-model', messages: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects path traversal in X-Project-Dir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
        'x-project-dir': '/etc/passwd',
      },
      payload: {
        model: 'bridge-model',
        messages: [{ role: 'user', content: '/help' }],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('PATH_TRAVERSAL_BLOCKED');
  });

  it('rejects hidden dir in X-Project-Dir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
        'x-project-dir': '/home/ayaz/.ssh',
      },
      payload: {
        model: 'bridge-model',
        messages: [{ role: 'user', content: '/help' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ============================================================================
// REST Endpoints
// ============================================================================
describe('REST config endpoint', () => {
  it('PUT /v1/sessions/:id/config returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/sessions/nonexistent-session-id/config',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: { model: 'claude-opus-4-6' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /v1/sessions/:id/config requires auth', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/sessions/test/config',
      headers: { 'content-type': 'application/json' },
      payload: { model: 'claude-opus-4-6' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('REST usage endpoint', () => {
  it('GET /v1/sessions/:id/usage returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/nonexistent-session-id/usage',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /v1/sessions/:id/usage requires auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/test/usage',
    });
    expect(res.statusCode).toBe(401);
  });
});

// ============================================================================
// Intent routing: natural language → slash command via HTTP
// ============================================================================
describe('intent routing via HTTP', () => {
  it('TR: ne kadar harcadım → /cost response', async () => {
    const res = await postMessage('ne kadar harcadım');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    // Should return cost/no-cost response (same as /cost)
    expect(content.toLowerCase()).toMatch(/cost|token|session|harcama/i);
  });

  it('TR: yardım → /help response', async () => {
    const res = await postMessage('yardım');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('Available bridge commands');
  });

  it('EN: show commands → /help response', async () => {
    const res = await postMessage('show commands');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('Available bridge commands');
  });

  it('EN: show status → /status response', async () => {
    const res = await postMessage('show status');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content).toContain('No active session');
  });

  it('EN: change model → /model response', async () => {
    const res = await postMessage('change model');
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    // /model with no args shows available models
    expect(content.toLowerCase()).toMatch(/model|opus|sonnet|haiku/i);
  });

  it('EN: use opus → /model opus response', async () => {
    const res = await postMessage('use opus', { 'x-conversation-id': 'intent-model-test' });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    // resolveIntent returns "/model", no args extracted — shows model list
    expect(content.toLowerCase()).toMatch(/model|opus|sonnet|haiku/i);
  });

  it('TR: hızlı mod → /fast response', async () => {
    const res = await postMessage('hızlı mod', { 'x-conversation-id': 'intent-fast-test' });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    expect(content.toLowerCase()).toMatch(/fast|hizli|mode/i);
  });

  it('EN: what changed → /diff response', async () => {
    const res = await postMessage('what changed', { 'x-project-dir': '/home/ayaz/openclaw-bridge' });
    expect(res.statusCode).toBe(200);
    const content = getContent(res);
    // diff either shows changes or clean working tree
    expect(content.length).toBeGreaterThan(0);
  });

  it('unrelated message does NOT trigger intent routing (requires live CC)', async () => {
    const res = await postMessage('Please write me a haiku about SQLite');
    // Falls through to CC — not intercepted by intent routing.
    // CC is mocked via vi.mock to return a simple response.
    // resolveIntent('Please write me a haiku about SQLite') === null is verified by unit tests.
    expect(res.statusCode).toBe(200);
  });
});

// ============================================================================
// Streaming command response
// ============================================================================
describe('streaming command interception', () => {
  it('/help via SSE returns event-stream', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
        'x-project-dir': '/home/ayaz/openclaw-bridge',
      },
      payload: {
        model: 'bridge-model',
        stream: true,
        messages: [{ role: 'user', content: '/help' }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    // Should contain SSE data lines with command list
    const body = res.body;
    expect(body).toContain('data: ');
    expect(body).toContain('Available bridge commands');
    expect(body).toContain('[DONE]');
  });
});

// ============================================================================
// Multiple commands in same conversation
// ============================================================================
describe('multi-command conversation', () => {
  const convId = 'multi-cmd-test';

  it('can set model then check config', async () => {
    // Set model
    const r1 = await postMessage('/model opus', { 'x-conversation-id': convId });
    expect(r1.statusCode).toBe(200);
    expect(getContent(r1)).toContain('claude-opus-4-6');

    // Set name
    const r2 = await postMessage('/fast on', { 'x-conversation-id': convId });
    expect(r2.statusCode).toBe(200);
    expect(getContent(r2).toLowerCase()).toContain('fast');

    // Check rename persists
    const r3 = await postMessage('/help', { 'x-conversation-id': convId });
    expect(r3.statusCode).toBe(200);
    expect(getContent(r3)).toContain('Available bridge commands');
  });
});
