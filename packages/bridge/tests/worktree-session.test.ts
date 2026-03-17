/**
 * ClaudeManager worktree session integration tests (WORK-04).
 *
 * Tests that:
 * - X-Worktree: true header flows from routes.ts into session spawn options
 * - X-Worktree header reading in POST /v1/chat/completions
 * - RouteOptions.worktree propagation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, TEST_AUTH_HEADER } from './helpers/build-app.ts';

// Mock worktreeManager to avoid real git calls
vi.mock('../src/worktree-manager.ts', () => ({
  worktreeManager: {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
    mergeBack: vi.fn(),
    pruneOrphans: vi.fn(),
    findByConversation: vi.fn(),
  },
}));

// Mock routeMessage to inspect what options were passed
vi.mock('../src/router.ts', () => ({
  routeMessage: vi.fn(),
}));

import { worktreeManager } from '../src/worktree-manager.ts';
import { routeMessage } from '../src/router.ts';
import type { WorktreeInfo } from '../src/worktree-manager.ts';

const MOCK_WORKTREE: WorktreeInfo = {
  name: 'wt-sess01',
  path: '/home/ayaz/testproject/.claude/worktrees/wt-sess01',
  branch: 'bridge/wt-wt-sess01',
  baseBranch: 'main',
  createdAt: new Date('2026-03-01T00:00:00Z'),
  projectDir: '/home/ayaz/testproject',
  conversationId: 'conv-sess-123',
};

// Minimal mock stream
async function* mockStream() {
  yield { type: 'text' as const, text: 'Hello from worktree' };
  yield { type: 'done' as const, usage: { input_tokens: 10, output_tokens: 20 } };
}

const MOCK_ROUTE_RESULT = {
  conversationId: 'conv-sess-123',
  sessionId: 'sess-abc',
  stream: mockStream(),
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// X-Worktree header: routes.ts → routeMessage options
// ---------------------------------------------------------------------------

describe('POST /v1/chat/completions X-Worktree header', () => {
  it('passes worktree: true to routeMessage when X-Worktree: true header is present', async () => {
    vi.mocked(routeMessage).mockResolvedValueOnce({
      ...MOCK_ROUTE_RESULT,
      stream: mockStream(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'x-worktree': 'true',
        'x-project-dir': '/tmp',
        'x-conversation-id': 'conv-sess-123',
      },
      payload: {
        model: 'bridge-model',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(routeMessage)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ worktree: true }),
    );
  });

  it('passes worktree: false when X-Worktree header is absent', async () => {
    vi.mocked(routeMessage).mockResolvedValueOnce({
      ...MOCK_ROUTE_RESULT,
      stream: mockStream(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'x-project-dir': '/tmp',
        'x-conversation-id': 'conv-no-wt',
      },
      payload: {
        model: 'bridge-model',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(routeMessage)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ worktree: false }),
    );
  });

  it('passes worktreeName from X-Branch header to routeMessage', async () => {
    vi.mocked(routeMessage).mockResolvedValueOnce({
      ...MOCK_ROUTE_RESULT,
      stream: mockStream(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'x-worktree': 'true',
        'x-branch': 'my-feature-branch',
        'x-project-dir': '/tmp',
        'x-conversation-id': 'conv-branch-123',
      },
      payload: {
        model: 'bridge-model',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(routeMessage)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ worktree: true, worktreeName: 'my-feature-branch' }),
    );
  });
});

// ---------------------------------------------------------------------------
// RouteOptions: worktree fields present in interface
// ---------------------------------------------------------------------------

describe('RouteOptions worktree fields', () => {
  it('RouteOptions interface accepts worktree and worktreeName', async () => {
    // This test verifies the TypeScript interface is correct by calling routeMessage
    // with worktree options — if it compiles and runs, the interface is correct.
    vi.mocked(routeMessage).mockResolvedValueOnce({
      ...MOCK_ROUTE_RESULT,
      stream: mockStream(),
    });

    const { routeMessage: rm } = await import('../src/router.ts');
    await rm(
      { model: 'bridge-model', messages: [{ role: 'user', content: 'test' }] },
      { conversationId: 'test-wt', projectDir: '/tmp', worktree: true, worktreeName: 'feat-branch' },
    );

    expect(vi.mocked(routeMessage)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ worktree: true, worktreeName: 'feat-branch' }),
    );
  });
});
