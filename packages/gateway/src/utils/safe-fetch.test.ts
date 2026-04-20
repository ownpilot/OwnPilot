/**
 * Safe Fetch Tests
 *
 * Tests safeFetch without mocking ssrf.js (which would conflict with
 * other test files). SSRF protection is tested via node-executors tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('../services/log.js', () => ({
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// =============================================================================
// Import after mocks
// =============================================================================

const { safeFetch, SafeFetchError, DEFAULT_MAX_REQUEST_BODY_SIZE } = await import('./safe-fetch.js');

// =============================================================================
// Helpers
// =============================================================================

function makeResponse(overrides: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  location?: string;
} = {}): Response {
  const headers = new Map(Object.entries(overrides.headers ?? { 'content-type': 'text/plain' }));
  if (overrides.location) {
    headers.set('location', overrides.location);
  }
  const get = (k: string) => headers.get(k) ?? null;
  return {
    ok: (overrides.status ?? 200) >= 200 && (overrides.status ?? 200) < 300,
    status: overrides.status ?? 200,
    statusText: 'OK',
    headers: { get, forEach: (fn: (v: string, k: string) => void) => headers.forEach(fn) } as unknown as Headers,
    text: async () => overrides.body ?? '',
    json: async () => (overrides.body ? JSON.parse(overrides.body) : undefined),
    body: null,
    redirected: false,
    url: 'https://example.com/api',
    clone: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

// =============================================================================
// Tests
// =============================================================================

describe('safeFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Basic fetch
  // ---------------------------------------------------------------------------

  it('returns a successful response directly when not a redirect', async () => {
    const mockResponse = makeResponse({ status: 200, body: 'hello' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const result = await safeFetch('https://example.com/api');

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({ redirect: 'manual' })
    );
    fetchSpy.mockRestore();
  });

  it('passes method, headers, and body through to fetch', async () => {
    const mockResponse = makeResponse({ status: 200, body: 'ok' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await safeFetch('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"hello":"world"}',
      })
    );
    fetchSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // Request body size cap
  // ---------------------------------------------------------------------------

  it('throws BODY_TOO_LARGE when request body exceeds maxRequestBodySize', async () => {
    const hugeBody = 'x'.repeat(DEFAULT_MAX_REQUEST_BODY_SIZE + 1);

    await expect(
      safeFetch('https://example.com/api', { method: 'POST', body: hugeBody })
    ).rejects.toThrow(SafeFetchError);
  });

  it('does not check body size when no body is provided', async () => {
    const mockResponse = makeResponse({ status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await safeFetch('https://example.com/api', { method: 'GET' });

    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // SafeFetchError
  // ---------------------------------------------------------------------------

  it('SafeFetchError has correct name and code property', () => {
    const e = new SafeFetchError('test', 'SSRF_BLOCKED');
    expect(e.name).toBe('SafeFetchError');
    expect(e.code).toBe('SSRF_BLOCKED');
    expect(e instanceof Error).toBe(true);
  });

  it('SafeFetchError codes cover all error types', () => {
    const codes: SafeFetchError['code'][] = [
      'SSRF_BLOCKED',
      'TOO_MANY_REDIRECTS',
      'BODY_TOO_LARGE',
      'TIMEOUT',
      'UNKNOWN',
    ];
    for (const code of codes) {
      const e = new SafeFetchError('msg', code);
      expect(e.code).toBe(code);
    }
  });
});
