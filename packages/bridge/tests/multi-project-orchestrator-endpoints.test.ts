/**
 * Multi-Project Orchestration HTTP Endpoint Tests (H6)
 *
 * Tests:
 * - POST /orchestrate/multi  (MULTI-01)
 * - GET  /orchestrate/multi/:multiOrchId  (MULTI-02)
 * - GET  /orchestrate/multi  (MULTI-03)
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MultiProjectState } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Mock multiProjectOrchestrator BEFORE importing buildApp
// ---------------------------------------------------------------------------

const { mockTrigger, mockGetById, mockListAll } = vi.hoisted(() => ({
  mockTrigger: vi.fn(),
  mockGetById: vi.fn(),
  mockListAll: vi.fn(),
}));

vi.mock('../src/multi-project-orchestrator.ts', () => ({
  multiProjectOrchestrator: {
    trigger: mockTrigger,
    getById: mockGetById,
    listAll: mockListAll,
    shutdown: vi.fn(),
  },
}));

import { buildApp, TEST_AUTH_HEADER } from './helpers/build-app.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMultiState(overrides: Partial<MultiProjectState> = {}): MultiProjectState {
  return {
    multiOrchId: 'multi-orch-test-1234',
    status: 'pending',
    projects: [
      { id: 'proj-a', dir: '/tmp/a', command: 'execute-phase', wave: 1, status: 'pending' },
    ],
    totalWaves: 1,
    currentWave: 0,
    startedAt: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

const VALID_BODY = {
  projects: [
    { id: 'a', dir: '/tmp/proj-a', command: 'execute-phase' },
    { id: 'b', dir: '/tmp/proj-b', command: 'execute-phase', depends_on: ['a'] },
  ],
};

// ---------------------------------------------------------------------------
// POST /orchestrate/multi
// ---------------------------------------------------------------------------

describe('POST /orchestrate/multi (MULTI-01)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrigger.mockResolvedValue(makeMultiState());
  });

  it('returns 202 with pending state on valid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/multi',
      headers: { Authorization: TEST_AUTH_HEADER },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json<MultiProjectState>();
    expect(body.multiOrchId).toBe('multi-orch-test-1234');
    expect(body.status).toBe('pending');
  });

  it('calls multiProjectOrchestrator.trigger() with correct items', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/multi',
      headers: { Authorization: TEST_AUTH_HEADER },
      payload: VALID_BODY,
    });
    expect(mockTrigger).toHaveBeenCalledWith(VALID_BODY.projects);
  });

  it('returns 400 when projects array is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/multi',
      headers: { Authorization: TEST_AUTH_HEADER },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when projects array is empty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/multi',
      headers: { Authorization: TEST_AUTH_HEADER },
      payload: { projects: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when item is missing dir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/multi',
      headers: { Authorization: TEST_AUTH_HEADER },
      payload: { projects: [{ command: 'execute-phase' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when item is missing command', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/multi',
      headers: { Authorization: TEST_AUTH_HEADER },
      payload: { projects: [{ dir: '/tmp/a' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on cycle/dependency graph error', async () => {
    mockTrigger.mockRejectedValue(
      Object.assign(new Error('Invalid dependency graph: cycle detected'), {
        code: 'INVALID_DEPENDENCY_GRAPH',
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/multi',
      headers: { Authorization: TEST_AUTH_HEADER },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/multi',
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 500 on unexpected trigger error', async () => {
    mockTrigger.mockRejectedValue(new Error('unexpected internal error'));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/multi',
      headers: { Authorization: TEST_AUTH_HEADER },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /orchestrate/multi/:multiOrchId
// ---------------------------------------------------------------------------

describe('GET /orchestrate/multi/:multiOrchId (MULTI-02)', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with state when found', async () => {
    const state = makeMultiState({ status: 'completed' });
    mockGetById.mockReturnValue(state);

    const res = await app.inject({
      method: 'GET',
      url: '/orchestrate/multi/multi-orch-test-1234',
      headers: { Authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<MultiProjectState>();
    expect(body.multiOrchId).toBe('multi-orch-test-1234');
    expect(body.status).toBe('completed');
  });

  it('returns 404 when not found', async () => {
    mockGetById.mockReturnValue(undefined);
    const res = await app.inject({
      method: 'GET',
      url: '/orchestrate/multi/nonexistent-id',
      headers: { Authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orchestrate/multi/multi-orch-test-1234',
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /orchestrate/multi
// ---------------------------------------------------------------------------

describe('GET /orchestrate/multi (MULTI-03)', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with sessions array and total', async () => {
    const sessions = [makeMultiState(), makeMultiState({ multiOrchId: 'multi-orch-second' })];
    mockListAll.mockReturnValue(sessions);

    const res = await app.inject({
      method: 'GET',
      url: '/orchestrate/multi',
      headers: { Authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ sessions: MultiProjectState[]; total: number }>();
    expect(body.sessions).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('returns empty array when no sessions', async () => {
    mockListAll.mockReturnValue([]);
    const res = await app.inject({
      method: 'GET',
      url: '/orchestrate/multi',
      headers: { Authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ sessions: []; total: number }>();
    expect(body.sessions).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orchestrate/multi',
    });
    expect(res.statusCode).toBe(401);
  });
});
