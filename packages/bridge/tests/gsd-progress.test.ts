/**
 * Tests for GET /v1/projects/:projectDir/gsd/progress — PROG-02
 *
 * Verifies that the endpoint returns GsdProgressState[] for active GSD sessions
 * matching the given projectDir, with proper auth enforcement.
 *
 * Strategy: Mock gsdOrchestration singleton via vi.hoisted + vi.mock.
 * buildApp() uses the real registerRoutes() which imports the mocked singleton.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mock gsdOrchestration BEFORE importing the app / routes
// vi.hoisted() ensures variables are initialized before vi.mock() factories run
// ---------------------------------------------------------------------------

const { mockListActive, mockGetProgress } = vi.hoisted(() => ({
  mockListActive: vi.fn(),
  mockGetProgress: vi.fn(),
}));

vi.mock('../src/gsd-orchestration.ts', () => ({
  gsdOrchestration: {
    trigger: vi.fn(),
    listActive: mockListActive,
    getStatus: vi.fn(),
    getProgress: mockGetProgress,
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks are set up
// ---------------------------------------------------------------------------

import { buildApp, TEST_AUTH_HEADER } from './helpers/build-app.ts';
import type { GsdSessionState, GsdProgressState } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_DIR = '/home/ayaz/myproj';
const ENCODED_DIR = encodeURIComponent(PROJECT_DIR);

function makeGsdState(overrides: Partial<GsdSessionState> = {}): GsdSessionState {
  return {
    gsdSessionId: 'gsd-uuid-1234',
    conversationId: 'conv-uuid-5678',
    projectDir: PROJECT_DIR,
    command: 'execute-phase',
    args: {},
    status: 'running',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProgressState(overrides: Partial<GsdProgressState> = {}): GsdProgressState {
  return {
    gsdSessionId: 'gsd-uuid-1234',
    projectDir: PROJECT_DIR,
    command: 'execute-phase',
    status: 'running',
    startedAt: new Date().toISOString(),
    phaseNumber: 3,
    plansCompleted: 2,
    plansTotal: 5,
    completionPercent: 40,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /v1/projects/:projectDir/gsd/progress (PROG-02)', () => {
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

  // -------------------------------------------------------------------------
  // Test 1: 401 without auth
  // -------------------------------------------------------------------------
  it('Test 1: returns 401 without Bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_DIR}/gsd/progress`,
    });

    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Test 2: empty array when no active sessions
  // -------------------------------------------------------------------------
  it('Test 2: returns 200 with empty array when no active GSD sessions', async () => {
    mockListActive.mockReturnValue([]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_DIR}/gsd/progress`,
      headers: { Authorization: TEST_AUTH_HEADER },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: returns GsdProgressState for one active session
  // -------------------------------------------------------------------------
  it('Test 3: returns 200 with GsdProgressState[] for an active session', async () => {
    const sessionState = makeGsdState();
    const progressState = makeProgressState();

    mockListActive.mockReturnValue([sessionState]);
    mockGetProgress.mockReturnValue(progressState);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_DIR}/gsd/progress`,
      headers: { Authorization: TEST_AUTH_HEADER },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].gsdSessionId).toBe('gsd-uuid-1234');
  });

  // -------------------------------------------------------------------------
  // Test 4: decoded projectDir is passed to listActive
  // -------------------------------------------------------------------------
  it('Test 4: decoded projectDir is passed to listActive', async () => {
    mockListActive.mockReturnValue([]);

    await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_DIR}/gsd/progress`,
      headers: { Authorization: TEST_AUTH_HEADER },
    });

    expect(mockListActive).toHaveBeenCalledWith(PROJECT_DIR);
  });

  // -------------------------------------------------------------------------
  // Test 5: response GsdProgressState has required shape fields
  // -------------------------------------------------------------------------
  it('Test 5: response includes phaseNumber, plansCompleted, plansTotal, completionPercent', async () => {
    const sessionState = makeGsdState();
    const progressState = makeProgressState({
      phaseNumber: 6,
      plansCompleted: 1,
      plansTotal: 2,
      completionPercent: 50,
    });

    mockListActive.mockReturnValue([sessionState]);
    mockGetProgress.mockReturnValue(progressState);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ENCODED_DIR}/gsd/progress`,
      headers: { Authorization: TEST_AUTH_HEADER },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    const progress = body[0] as GsdProgressState;
    expect(progress.phaseNumber).toBe(6);
    expect(progress.plansCompleted).toBe(1);
    expect(progress.plansTotal).toBe(2);
    expect(progress.completionPercent).toBe(50);
  });
});
