/**
 * Integration tests for GSD Orchestration HTTP Endpoints
 *
 * Tests cover:
 * - POST /v1/projects/:projectDir/gsd — ORCH-01: Trigger GSD workflow
 * - GET  /v1/projects/:projectDir/gsd/status — ORCH-02: GSD session status
 *
 * Strategy: Mock gsdOrchestration singleton so tests don't spawn real CC processes.
 * buildApp() uses the real registerRoutes() which imports the mocked gsdOrchestration.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mock gsdOrchestration BEFORE importing the app / routes
// vi.hoisted() ensures variables are initialized before vi.mock() factories run
// ---------------------------------------------------------------------------

const { mockTrigger, mockListActive } = vi.hoisted(() => ({
  mockTrigger: vi.fn(),
  mockListActive: vi.fn(),
}));

vi.mock('../src/gsd-orchestration.ts', () => ({
  gsdOrchestration: {
    trigger: mockTrigger,
    listActive: mockListActive,
    getStatus: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks are set up
// ---------------------------------------------------------------------------

import { buildApp, TEST_AUTH_HEADER } from './helpers/build-app.ts';
import type { GsdSessionState } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGsdState(overrides: Partial<GsdSessionState> = {}): GsdSessionState {
  return {
    gsdSessionId: 'gsd-test-uuid-1234',
    conversationId: 'gsd-conv-uuid-5678',
    projectDir: '/home/ayaz/myproj',
    command: 'execute-phase',
    args: {},
    status: 'pending',
    startedAt: '2026-03-02T00:00:00.000Z',
    ...overrides,
  };
}

const ENCODED_PROJECT_DIR = encodeURIComponent('/home/ayaz/myproj');
const PROJECT_A = encodeURIComponent('/home/ayaz/projA');
const PROJECT_B = encodeURIComponent('/home/ayaz/projB');

// ---------------------------------------------------------------------------
// POST /v1/projects/:projectDir/gsd
// ---------------------------------------------------------------------------

describe('POST /v1/projects/:projectDir/gsd (ORCH-01)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: trigger() returns a pending state
    mockTrigger.mockResolvedValue(makeGsdState());
    // Default: listActive() returns empty array
    mockListActive.mockReturnValue([]);
  });

  // -------------------------------------------------------------------------
  // Test 1: POST returns 202 with GsdSessionState
  // -------------------------------------------------------------------------
  it('Test 1: POST with valid command returns 202 with GsdSessionState', async () => {
    const state = makeGsdState({ command: 'execute-phase', args: { phase: 3 } });
    mockTrigger.mockResolvedValue(state);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_PROJECT_DIR}/gsd`,
      headers: { authorization: TEST_AUTH_HEADER, 'content-type': 'application/json' },
      payload: { command: 'execute-phase', args: { phase: 3 } },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json() as GsdSessionState;
    expect(body.gsdSessionId).toBe(state.gsdSessionId);
    expect(body.status).toBe('pending');
    expect(body.command).toBe('execute-phase');
  });

  // -------------------------------------------------------------------------
  // Test 2: POST without Authorization returns 401
  // -------------------------------------------------------------------------
  it('Test 2: POST without Authorization returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_PROJECT_DIR}/gsd`,
      headers: { 'content-type': 'application/json' },
      payload: { command: 'execute-phase' },
    });

    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Test 3: POST with missing 'command' field returns 400
  // -------------------------------------------------------------------------
  it('Test 3: POST with missing command returns 400 with error message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_PROJECT_DIR}/gsd`,
      headers: { authorization: TEST_AUTH_HEADER, 'content-type': 'application/json' },
      payload: { args: { phase: 3 } },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { message: string } };
    expect(body.error.message).toBe('command is required');
  });

  // -------------------------------------------------------------------------
  // Test 4: POST with config.model applies model override
  // -------------------------------------------------------------------------
  it('Test 4: POST with {config:{model:"opus"}} returns 202 and calls trigger with config', async () => {
    const state = makeGsdState({ command: 'plan-phase' });
    mockTrigger.mockResolvedValue(state);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_PROJECT_DIR}/gsd`,
      headers: { authorization: TEST_AUTH_HEADER, 'content-type': 'application/json' },
      payload: { command: 'plan-phase', config: { model: 'opus' } },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().gsdSessionId).toBe(state.gsdSessionId);
    // Verify trigger() was called with the config
    expect(mockTrigger).toHaveBeenCalledWith(
      '/home/ayaz/myproj',
      expect.objectContaining({ config: { model: 'opus' } }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 5: Two POSTs to different projectDirs both return 202 (cross-project concurrent)
  // -------------------------------------------------------------------------
  it('Test 5: POST to projA and projB both return 202 (cross-project concurrent)', async () => {
    const stateA = makeGsdState({ projectDir: '/home/ayaz/projA', command: 'execute-phase' });
    const stateB = makeGsdState({ projectDir: '/home/ayaz/projB', command: 'execute-phase', gsdSessionId: 'gsd-uuid-projB' });
    mockTrigger.mockResolvedValueOnce(stateA).mockResolvedValueOnce(stateB);

    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/projects/${PROJECT_A}/gsd`,
        headers: { authorization: TEST_AUTH_HEADER, 'content-type': 'application/json' },
        payload: { command: 'execute-phase' },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/projects/${PROJECT_B}/gsd`,
        headers: { authorization: TEST_AUTH_HEADER, 'content-type': 'application/json' },
        payload: { command: 'execute-phase' },
      }),
    ]);

    expect(resA.statusCode).toBe(202);
    expect(resB.statusCode).toBe(202);
  });

  // -------------------------------------------------------------------------
  // Test (ORCH-03): POST when project at quota returns 429
  // -------------------------------------------------------------------------
  it('Test 429: POST when project quota exceeded returns 429', async () => {
    const quotaError = Object.assign(
      new Error('Project concurrent limit exceeded'),
      { code: 'PROJECT_CONCURRENT_LIMIT' },
    );
    mockTrigger.mockRejectedValue(quotaError);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ENCODED_PROJECT_DIR}/gsd`,
      headers: { authorization: TEST_AUTH_HEADER, 'content-type': 'application/json' },
      payload: { command: 'execute-phase' },
    });

    expect(res.statusCode).toBe(429);
    const body = res.json() as { error: { message: string; type: string } };
    expect(body.error.message).toContain('concurrent limit');
  });
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:projectDir/gsd/status
// ---------------------------------------------------------------------------

describe('GET /v1/projects/:projectDir/gsd/status (ORCH-02)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockTrigger.mockResolvedValue(makeGsdState());
    mockListActive.mockReturnValue([]);
  });

  // -------------------------------------------------------------------------
  // Test 6: GET after triggering returns 200 with sessions and active count
  // -------------------------------------------------------------------------
  it('Test 6: GET returns 200 with {sessions, active} after a session is triggered', async () => {
    const state = makeGsdState({ status: 'running' });
    mockListActive.mockReturnValue([state]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_PROJECT_DIR}/gsd/status`,
      headers: { authorization: TEST_AUTH_HEADER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: GsdSessionState[]; active: number };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].gsdSessionId).toBe(state.gsdSessionId);
    expect(body.active).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 7: GET when no GSD session exists returns 200 with empty sessions
  // -------------------------------------------------------------------------
  it('Test 7: GET when no GSD sessions exist returns 200 with {sessions:[], active:0}', async () => {
    mockListActive.mockReturnValue([]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_PROJECT_DIR}/gsd/status`,
      headers: { authorization: TEST_AUTH_HEADER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: GsdSessionState[]; active: number };
    expect(body.sessions).toEqual([]);
    expect(body.active).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 8: GET without Authorization returns 401
  // -------------------------------------------------------------------------
  it('Test 8: GET without Authorization returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_PROJECT_DIR}/gsd/status`,
    });

    expect(res.statusCode).toBe(401);
  });
});
