import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolGetEvents, type BridgeConfig } from '../../mcp/tools.ts';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const testConfig: BridgeConfig = {
  url: 'http://localhost:9090',
  apiKey: 'test-api-key',
};

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toolGetEvents', () => {
  it('returns events array on 200', async () => {
    const payload = {
      events: [{ id: 1, type: 'session.done' }, { id: 2, type: 'session.output' }],
      count: 2,
      since_id: 0,
    };
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload });

    const result = await toolGetEvents(undefined, undefined, undefined, testConfig);

    expect(result.events).toHaveLength(2);
    expect(result.count).toBe(2);
    expect(result.since_id).toBe(0);
  });

  it('passes since_id as query param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [], count: 0, since_id: 42 }),
    });

    await toolGetEvents(42, undefined, undefined, testConfig);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('since_id=42');
  });

  it('passes project_dir filter when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [], count: 0, since_id: 0 }),
    });

    await toolGetEvents(undefined, undefined, '/home/ayaz/myproject', testConfig);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('project_dir=%2Fhome%2Fayaz%2Fmyproject');
  });

  it('passes limit as query param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [], count: 0, since_id: 0 }),
    });

    await toolGetEvents(undefined, 10, undefined, testConfig);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('limit=10');
  });

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(toolGetEvents(undefined, undefined, undefined, testConfig)).rejects.toThrow(
      'Bridge get_events error (HTTP 401)',
    );
  });

  it('sends Authorization header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [], count: 0, since_id: 0 }),
    });

    await toolGetEvents(undefined, undefined, undefined, testConfig);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(opts.headers['Authorization']).toBe('Bearer test-api-key');
  });
});
