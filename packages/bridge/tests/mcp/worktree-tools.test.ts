import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolWorktreeCreate, toolWorktreeList, toolWorktreeDelete, type BridgeConfig } from '../../mcp/tools.ts';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const testConfig: BridgeConfig = {
  url: 'http://localhost:9090',
  apiKey: 'test-api-key',
};

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── toolWorktreeCreate ───────────────────────────────────────────────────────

describe('toolWorktreeCreate', () => {
  it('returns worktree name/path/branch on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        name: 'feature-x',
        path: '/home/ayaz/proj/.worktrees/feature-x',
        branch: 'feature-x',
        projectDir: '/home/ayaz/proj',
      }),
    });

    const result = await toolWorktreeCreate('/home/ayaz/proj', 'feature-x', testConfig);

    expect(result).toEqual({
      name: 'feature-x',
      path: '/home/ayaz/proj/.worktrees/feature-x',
      branch: 'feature-x',
    });
  });

  it('sends POST with name in body when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ name: 'my-wt', path: '/p/.worktrees/my-wt', branch: 'my-wt' }),
    });

    await toolWorktreeCreate('/home/ayaz/proj', 'my-wt', testConfig);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ name: 'my-wt' });
  });

  it('sends POST with empty body when name omitted', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ name: 'auto-wt', path: '/p/.worktrees/auto-wt', branch: 'auto-wt' }),
    });

    await toolWorktreeCreate('/home/ayaz/proj', undefined, testConfig);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({});
  });

  it('URL-encodes projectDir', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ name: 'wt', path: '/p/.worktrees/wt', branch: 'wt' }),
    });

    await toolWorktreeCreate('/home/ayaz/my project', 'wt', testConfig);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(encodeURIComponent('/home/ayaz/my project'));
    expect(url).not.toContain('/home/ayaz/my project/');
  });
});

// ─── toolWorktreeList ─────────────────────────────────────────────────────────

describe('toolWorktreeList', () => {
  it('returns worktree array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { name: 'wt-1', path: '/p/.worktrees/wt-1', branch: 'wt-1' },
        { name: 'wt-2', path: '/p/.worktrees/wt-2', branch: 'wt-2' },
      ],
    });

    const result = await toolWorktreeList('/home/ayaz/proj', testConfig);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'wt-1', path: '/p/.worktrees/wt-1', branch: 'wt-1' });
    expect(result[1]).toEqual({ name: 'wt-2', path: '/p/.worktrees/wt-2', branch: 'wt-2' });
  });

  it('returns empty array when no worktrees', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const result = await toolWorktreeList('/home/ayaz/proj', testConfig);
    expect(result).toEqual([]);
  });
});

// ─── toolWorktreeDelete ───────────────────────────────────────────────────────

describe('toolWorktreeDelete', () => {
  it('returns {deleted: true} on 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ merged: true, removed: true, mergeResult: null }),
    });

    const result = await toolWorktreeDelete('/home/ayaz/proj', 'feature-x', testConfig);

    expect(result).toEqual({ deleted: true, name: 'feature-x' });
  });

  it('throws on 404 (worktree not found)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '{"error":{"message":"Worktree not found"}}',
    });

    await expect(toolWorktreeDelete('/home/ayaz/proj', 'ghost-wt', testConfig)).rejects.toThrow(
      'Bridge worktree_delete error (HTTP 404)',
    );
  });

  it('URL-encodes both projectDir and name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ merged: true, removed: true }),
    });

    await toolWorktreeDelete('/home/ayaz/my project', 'my wt', testConfig);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(encodeURIComponent('/home/ayaz/my project'));
    expect(url).toContain(encodeURIComponent('my wt'));
    expect(url).not.toMatch(/\/home\/ayaz\/my project/);
  });
});
