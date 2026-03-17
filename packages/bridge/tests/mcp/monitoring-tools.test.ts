import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  toolGetProjects,
  toolGetSessions,
  toolGetHealth,
  toolGetMetrics,
  toolSpawnCc,
  toolWorktreeCreate,
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

// ─── toolGetProjects ──────────────────────────────────────────────────────────

describe('toolGetProjects', () => {
  it('returns project list on 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { projectDir: '/home/ayaz/proj-a', sessions: { total: 3, active: 2, paused: 1 } },
        { projectDir: '/home/ayaz/proj-b', sessions: { total: 1, active: 0, paused: 1 } },
      ],
    });

    const result = await toolGetProjects(testConfig);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ projectDir: '/home/ayaz/proj-a', active: 2, paused: 1, total: 3 });
    expect(result[1]).toEqual({ projectDir: '/home/ayaz/proj-b', active: 0, paused: 1, total: 1 });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9090/v1/projects',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }) }),
    );
  });

  it('returns empty array when no projects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const result = await toolGetProjects(testConfig);
    expect(result).toEqual([]);
  });

  it('throws on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(toolGetProjects(testConfig)).rejects.toThrow(
      'Bridge get_projects error (HTTP 500)',
    );
  });
});

// ─── toolGetSessions ──────────────────────────────────────────────────────────

describe('toolGetSessions', () => {
  it('returns session list for project', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          sessionId: 'sess-1',
          conversationId: 'conv-1',
          status: 'active',
          projectDir: '/home/ayaz/myproject',
          tokens: { input: 0, output: 100 },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await toolGetSessions('/home/ayaz/myproject', testConfig);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sessionId: 'sess-1',
      conversationId: 'conv-1',
      status: 'active',
      projectDir: '/home/ayaz/myproject',
    });
  });

  it('URL-encodes projectDir in path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    await toolGetSessions('/home/ayaz/my project/dir', testConfig);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(encodeURIComponent('/home/ayaz/my project/dir'));
    expect(url).not.toContain('/home/ayaz/my project/dir');
  });

  it('returns empty array when no sessions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const result = await toolGetSessions('/home/ayaz/empty', testConfig);
    expect(result).toEqual([]);
  });
});

// ─── toolGetHealth — single-line JSON output ──────────────────────────────

describe('toolGetHealth', () => {
  it('error message includes actionable hint (single-line output context)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    await expect(toolGetHealth(testConfig)).rejects.toThrow(
      'Bridge may be starting up — wait 2s and retry',
    );
  });
});

// ─── toolGetMetrics — uptimeSeconds type ──────────────────────────────────

describe('toolGetMetrics', () => {
  it('error message includes actionable hint (uptimeSeconds context)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    await expect(toolGetMetrics(testConfig)).rejects.toThrow('check bridge logs');
  });
});

// ─── toolSpawnCc — actionable error ───────────────────────────────────────

describe('toolSpawnCc — actionable errors', () => {
  it('HTTP 500 error message includes overload hint with get_health() call', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => '',
    });
    await expect(
      toolSpawnCc({ project_dir: '/proj', content: 'test' }, testConfig),
    ).rejects.toThrow('Hints: invalid project_dir, timeout exceeded, or bridge overloaded');
  });
});

// ─── toolWorktreeCreate — actionable error ────────────────────────────────

describe('toolWorktreeCreate — actionable errors', () => {
  it('HTTP 409 error message includes conflict hint with worktree_list() call', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => '',
    });
    await expect(
      toolWorktreeCreate('/proj', 'my-wt', testConfig),
    ).rejects.toThrow('If HTTP 409: worktree name already exists');
  });
});
