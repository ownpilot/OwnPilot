/**
 * Worktree REST endpoint integration tests.
 *
 * Tests POST/GET/DELETE /v1/projects/:projectDir/worktrees endpoints.
 * Mocks worktreeManager to avoid real git calls.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, TEST_AUTH_HEADER } from './helpers/build-app.ts';

// Mock worktreeManager to avoid real git calls in integration tests
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

// Import the mock AFTER vi.mock declaration
import { worktreeManager } from '../src/worktree-manager.ts';
import type { WorktreeInfo, MergeResult } from '../src/worktree-manager.ts';

const ENCODED_DIR = encodeURIComponent('/home/ayaz/testproject');

const MOCK_WORKTREE: WorktreeInfo = {
  name: 'wt-abc123',
  path: '/home/ayaz/testproject/.claude/worktrees/wt-abc123',
  branch: 'bridge/wt-wt-abc123',
  baseBranch: 'main',
  createdAt: new Date('2026-03-01T00:00:00Z'),
  projectDir: '/home/ayaz/testproject',
  conversationId: 'conv-123',
};

const MOCK_MERGE_SUCCESS: MergeResult = {
  success: true,
  strategy: 'merge-commit',
  commitHash: 'abc1234',
};

const MOCK_MERGE_CONFLICT: MergeResult = {
  success: false,
  strategy: 'conflict',
  conflictFiles: ['src/foo.ts', 'src/bar.ts'],
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /v1/projects/:projectDir/worktrees
// ---------------------------------------------------------------------------

describe('POST /v1/projects/:projectDir/worktrees', () => {
  it('returns 201 with WorktreeInfo on success', async () => {
    vi.mocked(worktreeManager.create).mockResolvedValueOnce(MOCK_WORKTREE);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_DIR}/worktrees`,
      headers: { authorization: TEST_AUTH_HEADER },
      payload: { name: 'wt-abc123' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('wt-abc123');
    expect(body.branch).toBe('bridge/wt-wt-abc123');
    expect(body.projectDir).toBe('/home/ayaz/testproject');
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_DIR}/worktrees`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when create throws "not a git repository"', async () => {
    vi.mocked(worktreeManager.create).mockRejectedValueOnce(
      new Error('not a git repository: /home/ayaz/testproject'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_DIR}/worktrees`,
      headers: { authorization: TEST_AUTH_HEADER },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('NOT_A_GIT_REPO');
  });

  it('returns 400 when create throws "Worktree name too long"', async () => {
    vi.mocked(worktreeManager.create).mockRejectedValueOnce(
      new Error('Worktree name too long (max 100 characters)'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_DIR}/worktrees`,
      headers: { authorization: TEST_AUTH_HEADER },
      payload: { name: 'a'.repeat(101) },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('WORKTREE_NAME_TOO_LONG');
    expect(body.error.type).toBe('invalid_request');
  });

  it('returns 429 when create throws "Max worktrees"', async () => {
    vi.mocked(worktreeManager.create).mockRejectedValueOnce(
      new Error('Max worktrees (5) exceeded for project'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_DIR}/worktrees`,
      headers: { authorization: TEST_AUTH_HEADER },
      payload: {},
    });

    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error.code).toBe('WORKTREE_LIMIT');
  });
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:projectDir/worktrees
// ---------------------------------------------------------------------------

describe('GET /v1/projects/:projectDir/worktrees', () => {
  it('returns 200 with array of worktrees', async () => {
    vi.mocked(worktreeManager.list).mockResolvedValueOnce([MOCK_WORKTREE]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_DIR}/worktrees`,
      headers: { authorization: TEST_AUTH_HEADER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('wt-abc123');
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_DIR}/worktrees`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty array when no worktrees exist', async () => {
    vi.mocked(worktreeManager.list).mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_DIR}/worktrees`,
      headers: { authorization: TEST_AUTH_HEADER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /v1/projects/:projectDir/worktrees/:name
// ---------------------------------------------------------------------------

describe('DELETE /v1/projects/:projectDir/worktrees/:name', () => {
  it('returns 200 with merged:true and MergeResult on successful merge', async () => {
    vi.mocked(worktreeManager.get).mockResolvedValueOnce(MOCK_WORKTREE);
    vi.mocked(worktreeManager.mergeBack).mockResolvedValueOnce(MOCK_MERGE_SUCCESS);
    vi.mocked(worktreeManager.remove).mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ENCODED_DIR}/worktrees/wt-abc123`,
      headers: { authorization: TEST_AUTH_HEADER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.merged).toBe(true);
    expect(body.removed).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ENCODED_DIR}/worktrees/wt-abc123`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when worktree not found', async () => {
    vi.mocked(worktreeManager.get).mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ENCODED_DIR}/worktrees/nonexistent`,
      headers: { authorization: TEST_AUTH_HEADER },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.type).toBe('not_found');
  });

  it('returns 200 with conflict:true and conflictFiles when merge conflicts (worktree preserved)', async () => {
    vi.mocked(worktreeManager.get).mockResolvedValueOnce(MOCK_WORKTREE);
    vi.mocked(worktreeManager.mergeBack).mockResolvedValueOnce(MOCK_MERGE_CONFLICT);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ENCODED_DIR}/worktrees/wt-abc123`,
      headers: { authorization: TEST_AUTH_HEADER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.merged).toBe(false);
    expect(body.conflict).toBe(true);
    expect(body.conflictFiles).toEqual(['src/foo.ts', 'src/bar.ts']);
    // remove() should NOT have been called — worktree preserved for manual resolution
    expect(vi.mocked(worktreeManager.remove)).not.toHaveBeenCalled();
  });
});
