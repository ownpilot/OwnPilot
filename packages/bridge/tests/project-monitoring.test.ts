import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ClaudeManager } from '../src/claude-manager.ts';
import { claudeManager } from '../src/claude-manager.ts';
import { buildApp, TEST_AUTH_HEADER } from './helpers/build-app.ts';
import {
  incrementProjectSpawn,
  recordProjectActiveDuration,
  getProjectMetrics,
  resetProjectMetrics,
} from '../src/metrics.ts';
import type { ProjectSessionDetail, ProjectResourceMetrics } from '../src/types.ts';

/**
 * Tests for project monitoring data layer:
 * - Per-project metrics (spawn count, active duration) in metrics.ts
 * - ClaudeManager.getProjectSessionDetails() and getProjectResourceMetrics()
 */

describe('Per-Project Metrics (metrics.ts)', () => {
  afterEach(() => {
    resetProjectMetrics();
  });

  it('incrementProjectSpawn tracks spawn count per project', () => {
    incrementProjectSpawn('/home/ayaz/projA');
    incrementProjectSpawn('/home/ayaz/projA');
    const metrics = getProjectMetrics();
    const projA = metrics.find((m) => m.projectDir === '/home/ayaz/projA');
    expect(projA).toBeDefined();
    expect(projA!.spawnCount).toBe(2);
  });

  it('recordProjectActiveDuration tracks duration per project', () => {
    incrementProjectSpawn('/home/ayaz/projA'); // must exist first
    recordProjectActiveDuration('/home/ayaz/projA', 5000);
    const metrics = getProjectMetrics();
    const projA = metrics.find((m) => m.projectDir === '/home/ayaz/projA');
    expect(projA).toBeDefined();
    expect(projA!.activeDurationMs).toBe(5000);
  });

  it('getProjectMetrics returns empty array when no project spawns recorded', () => {
    const metrics = getProjectMetrics();
    expect(metrics).toEqual([]);
  });

  it('resetProjectMetrics clears all per-project data', () => {
    incrementProjectSpawn('/home/ayaz/projA');
    incrementProjectSpawn('/home/ayaz/projB');
    resetProjectMetrics();
    const metrics = getProjectMetrics();
    expect(metrics).toEqual([]);
  });
});

describe('ClaudeManager Project Session Details', () => {
  let manager: ClaudeManager;

  beforeEach(() => {
    manager = new ClaudeManager();
  });

  afterEach(() => {
    resetProjectMetrics();
  });

  it('getProjectSessionDetails returns session list for a known project', async () => {
    const projectDir = '/home/ayaz/proj-detail';
    await manager.getOrCreate('detail-1', { projectDir });
    await manager.getOrCreate('detail-2', { projectDir });

    // Make detail-1 active (use current process PID so isProcessAlive() returns true)
    const s1 = (manager as any).sessions.get('detail-1');
    if (s1) s1.activeProcess = { pid: process.pid, kill: vi.fn(), killed: false } as any;

    // Make detail-2 paused
    const s2 = (manager as any).sessions.get('detail-2');
    if (s2) s2.paused = true;

    const details: ProjectSessionDetail[] = manager.getProjectSessionDetails(projectDir);
    expect(details).toHaveLength(2);

    const d1 = details.find((d) => d.conversationId === 'detail-1');
    expect(d1).toBeDefined();
    expect(d1!.status).toBe('active');
    expect(d1!.projectDir).toBe(projectDir);

    const d2 = details.find((d) => d.conversationId === 'detail-2');
    expect(d2).toBeDefined();
    expect(d2!.status).toBe('paused');

    // Cleanup
    manager.terminate('detail-1');
    manager.terminate('detail-2');
  });

  it('getProjectSessionDetails returns empty array for unknown project', () => {
    const details = manager.getProjectSessionDetails('/home/ayaz/nonexistent');
    expect(details).toEqual([]);
  });

  it('getProjectResourceMetrics aggregates tokens, spawn count, and session count per project', async () => {
    const projectDir = '/home/ayaz/proj-resource';
    await manager.getOrCreate('res-1', { projectDir });
    await manager.getOrCreate('res-2', { projectDir });

    // Set some token usage
    const s1 = (manager as any).sessions.get('res-1');
    if (s1) s1.info.tokensUsed = 1000;
    const s2 = (manager as any).sessions.get('res-2');
    if (s2) s2.info.tokensUsed = 500;

    // Record per-project metrics
    incrementProjectSpawn(projectDir);
    incrementProjectSpawn(projectDir);
    incrementProjectSpawn(projectDir);
    recordProjectActiveDuration(projectDir, 10000);

    const resourceMetrics: ProjectResourceMetrics[] = manager.getProjectResourceMetrics();
    expect(resourceMetrics.length).toBeGreaterThanOrEqual(1);

    const proj = resourceMetrics.find((r) => r.projectDir === projectDir);
    expect(proj).toBeDefined();
    expect(proj!.totalTokens).toBe(1500);
    expect(proj!.spawnCount).toBe(3);
    expect(proj!.activeDurationMs).toBe(10000);
    expect(proj!.sessionCount).toBe(2);

    // Cleanup
    manager.terminate('res-1');
    manager.terminate('res-2');
  });
});

// ---------------------------------------------------------------------------
// Endpoint integration tests (MON-01, MON-02, MON-03)
// ---------------------------------------------------------------------------

describe('GET /v1/projects (MON-01)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    // Terminate any test sessions created via claudeManager singleton
    const sessions = claudeManager.getSessions();
    for (const s of sessions) {
      claudeManager.terminate(s.conversationId);
    }
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 + empty array when no sessions exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns array with project stats after creating sessions', async () => {
    const projectDir = '/home/ayaz/mon-test-project';
    await claudeManager.getOrCreate('mon-p1', { projectDir });
    await claudeManager.getOrCreate('mon-p2', { projectDir });

    // Make mon-p1 active
    const s1 = (claudeManager as any).sessions.get('mon-p1');
    if (s1) s1.activeProcess = { pid: 9090, kill: vi.fn(), killed: false } as any;

    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ projectDir: string; sessions: { total: number; active: number; paused: number } }>;
    const proj = body.find((p) => p.projectDir === projectDir);
    expect(proj).toBeDefined();
    expect(proj!.sessions.total).toBe(2);
    expect(proj!.sessions.active).toBe(1);
    expect(proj!.sessions.paused).toBe(0);
  });
});

describe('GET /v1/projects/:projectDir/sessions (MON-02)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    const sessions = claudeManager.getSessions();
    for (const s of sessions) {
      claudeManager.terminate(s.conversationId);
    }
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${encodeURIComponent('/home/ayaz/test')}/sessions`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 + empty array for unknown project', async () => {
    const encodedDir = encodeURIComponent('/home/ayaz/nonexistent-project');
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${encodedDir}/sessions`,
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns session list for known project (URL-encoded projectDir)', async () => {
    const projectDir = '/home/ayaz/mon-session-test';
    await claudeManager.getOrCreate('mon-s1', { projectDir });
    await claudeManager.getOrCreate('mon-s2', { projectDir });

    // Make mon-s1 active (use current process PID so isProcessAlive() returns true)
    const s1 = (claudeManager as any).sessions.get('mon-s1');
    if (s1) s1.activeProcess = { pid: process.pid, kill: vi.fn(), killed: false } as any;

    const encodedDir = encodeURIComponent(projectDir);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${encodedDir}/sessions`,
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ProjectSessionDetail[];
    expect(body).toHaveLength(2);

    const d1 = body.find((d) => d.conversationId === 'mon-s1');
    expect(d1).toBeDefined();
    expect(d1!.status).toBe('active');
    expect(d1!.projectDir).toBe(projectDir);
    expect(d1!.tokens).toBeDefined();
    expect(typeof d1!.tokens.input).toBe('number');
    expect(typeof d1!.tokens.output).toBe('number');
  });

  it('URL decoding works correctly (encoded slashes)', async () => {
    const projectDir = '/home/ayaz/openclaw-bridge';
    await claudeManager.getOrCreate('mon-slash-1', { projectDir });

    // Encode with slashes encoded
    const encodedDir = encodeURIComponent(projectDir);
    expect(encodedDir).toContain('%2F');

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${encodedDir}/sessions`,
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ProjectSessionDetail[];
    const found = body.find((d) => d.conversationId === 'mon-slash-1');
    expect(found).toBeDefined();
    expect(found!.projectDir).toBe(projectDir);
  });
});

describe('GET /v1/metrics/projects (MON-03)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    resetProjectMetrics();
    const sessions = claudeManager.getSessions();
    for (const s of sessions) {
      claudeManager.terminate(s.conversationId);
    }
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/metrics/projects' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 + empty array when no data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/metrics/projects',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns per-project metrics after activity', async () => {
    const projectDir = '/home/ayaz/mon-metrics-test';
    incrementProjectSpawn(projectDir);
    incrementProjectSpawn(projectDir);
    recordProjectActiveDuration(projectDir, 8000);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/metrics/projects',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ProjectResourceMetrics[];
    const proj = body.find((p) => p.projectDir === projectDir);
    expect(proj).toBeDefined();
    expect(proj!.spawnCount).toBe(2);
    expect(proj!.activeDurationMs).toBe(8000);
    expect(typeof proj!.totalTokens).toBe('number');
    expect(typeof proj!.sessionCount).toBe('number');
  });
});
