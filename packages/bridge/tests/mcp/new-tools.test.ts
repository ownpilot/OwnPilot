import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  toolGetOrchestrationDetail,
  toolSessionTerminate,
  toolGetHealth,
  toolGetGsdProgress,
  toolGetMetrics,
  type BridgeConfig,
} from '../../mcp/tools.ts';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const testConfig: BridgeConfig = {
  url: 'http://localhost:9090',
  apiKey: 'test-api-key',
};

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── toolGetOrchestrationDetail ───────────────────────────────────────────────

describe('toolGetOrchestrationDetail', () => {
  const projectDir = '/home/ayaz/myproject';
  const orchestrationId = 'orch-abc123';

  it('returns full orchestration state on 200', async () => {
    const state = {
      orchestrationId,
      projectDir,
      message: '/gsd:execute-phase 10',
      scope_in: 'src/',
      scope_out: 'infra/',
      status: 'running',
      currentStage: 'research',
      startedAt: '2026-01-01T00:00:00.000Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => state,
    });

    const result = await toolGetOrchestrationDetail(projectDir, orchestrationId, testConfig);

    expect(result).toEqual(state);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(encodeURIComponent(projectDir));
    expect(url).toContain(orchestrationId);
    expect(url).toContain('/status');
  });

  it('URL-encodes projectDir', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    await toolGetOrchestrationDetail('/home/ayaz/my project', orchestrationId, testConfig);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(encodeURIComponent('/home/ayaz/my project'));
    expect(url).not.toContain('/home/ayaz/my project/');
  });

  it('throws 404 on not found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(
      toolGetOrchestrationDetail(projectDir, 'missing-id', testConfig),
    ).rejects.toThrow('Bridge get_orchestration_detail error (HTTP 404)');
  });
});

// ─── toolSessionTerminate ────────────────────────────────────────────────────

describe('toolSessionTerminate', () => {
  it('terminates session and returns result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Session terminated', conversationId: 'conv-42' }),
    });

    const result = await toolSessionTerminate('conv-42', testConfig);

    expect(result).toEqual({ message: 'Session terminated', conversationId: 'conv-42' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9090/v1/sessions/conv-42',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      }),
    );
  });

  it('throws on 404 not found', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

    await expect(toolSessionTerminate('no-such-id', testConfig)).rejects.toThrow(
      'Bridge session_terminate error (HTTP 404)',
    );
  });
});

// ─── toolGetHealth ────────────────────────────────────────────────────────────

describe('toolGetHealth', () => {
  it('returns health response on 200', async () => {
    const healthBody = {
      status: 'ok',
      timestamp: '2026-01-01T00:00:00.000Z',
      circuitBreaker: { state: 'closed', failures: 0, openedAt: null },
      sessions: [],
      activeSessions: 0,
      pausedSessions: 0,
      totalSessions: 0,
    };

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => healthBody });

    const result = await toolGetHealth(testConfig);

    expect(result).toEqual(healthBody);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9090/health',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }) }),
    );
  });

  it('throws on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' });

    await expect(toolGetHealth(testConfig)).rejects.toThrow(
      'Bridge get_health error (HTTP 503)',
    );
  });
});

// ─── toolGetGsdProgress ───────────────────────────────────────────────────────

describe('toolGetGsdProgress', () => {
  const projectDir = '/home/ayaz/myproject';

  it('returns GSD progress states on 200', async () => {
    const progressStates = [
      {
        gsdSessionId: 'gsd-1',
        phase: 10,
        status: 'running',
        plan: 'plan-10-01',
        startedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => progressStates });

    const result = await toolGetGsdProgress(projectDir, testConfig);

    expect(result).toEqual(progressStates);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(encodeURIComponent(projectDir));
    expect(url).toContain('/gsd/progress');
  });

  it('returns empty array when no active GSD sessions', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });

    const result = await toolGetGsdProgress(projectDir, testConfig);
    expect(result).toEqual([]);
  });

  it('throws on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });

    await expect(toolGetGsdProgress(projectDir, testConfig)).rejects.toThrow(
      'Bridge get_gsd_progress error (HTTP 500)',
    );
  });
});

// ─── toolGetMetrics ───────────────────────────────────────────────────────────

describe('toolGetMetrics', () => {
  it('returns metrics on 200', async () => {
    const metricsBody = {
      activeSessions: 2,
      pausedSessions: 1,
      totalRequests: 100,
      averageResponseMs: 350,
    };

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => metricsBody });

    const result = await toolGetMetrics(testConfig);

    expect(result).toEqual(metricsBody);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9090/metrics',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }) }),
    );
  });

  it('throws on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });

    await expect(toolGetMetrics(testConfig)).rejects.toThrow(
      'Bridge get_metrics error (HTTP 401)',
    );
  });
});
