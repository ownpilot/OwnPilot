import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  httpRequestTool,
  httpRequestExecutor,
  fetchWebPageTool,
  fetchWebPageExecutor,
  searchWebTool,
  searchWebExecutor,
  jsonApiTool,
  jsonApiExecutor,
  readResponseBodySafely,
  describeHttpStatus,
  describeNetworkError,
  parseRetryAfter,
  WEB_FETCH_TOOLS,
} from './web-fetch.js';

// Mock DNS lookups for SSRF protection
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (_hostname: string) => {
    // Return a public IP for any hostname in tests
    return [{ address: '93.184.216.34', family: 4 }];
  }),
}));

import { lookup as dnsLookup } from 'node:dns/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ToolContext stub (all executors use _context, so this is never read). */
const ctx = {} as any;

/** Build a mock Response from overrides. */
function mockResponse(
  overrides: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string;
    json?: unknown;
  } = {}
): Response {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    url = 'https://example.com',
    headers = {},
    body = '',
    json,
  } = overrides;

  const headerMap = new Map(Object.entries(headers));

  // Keep text() and json() consistent the way a real Response is: when a json
  // payload is given, the wire body IS its serialization. readResponseBodySafely
  // reads text() then parses, so the two must agree.
  const wireBody = json !== undefined ? JSON.stringify(json) : body;

  return {
    ok,
    status,
    statusText,
    url,
    headers: {
      get(name: string) {
        return headerMap.get(name) ?? null;
      },
      forEach(cb: (value: string, key: string) => void) {
        headerMap.forEach((v, k) => cb(v, k));
      },
    },
    text: vi.fn().mockResolvedValue(wireBody),
    json: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(json !== undefined ? json : JSON.parse(body || '{}'))
      ),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const fetchMock = vi.fn<(...args: any[]) => Promise<Response>>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// =============================================================================
// WEB_FETCH_TOOLS export
// =============================================================================

describe('WEB_FETCH_TOOLS', () => {
  it('exports exactly four tool pairs', () => {
    expect(WEB_FETCH_TOOLS).toHaveLength(4);
  });

  it('contains correct tool names', () => {
    const names = WEB_FETCH_TOOLS.map((t) => t.definition.name);
    expect(names).toEqual(['http_request', 'fetch_web_page', 'search_web', 'call_json_api']);
  });

  it('each entry has a definition and an executor function', () => {
    for (const entry of WEB_FETCH_TOOLS) {
      expect(entry.definition).toBeDefined();
      expect(entry.definition.name).toBeTypeOf('string');
      expect(entry.executor).toBeTypeOf('function');
    }
  });
});

// =============================================================================
// Tool definitions (schema validation)
// =============================================================================

describe('httpRequestTool definition', () => {
  it('has name "http_request"', () => {
    expect(httpRequestTool.name).toBe('http_request');
  });

  it('requires url', () => {
    expect(httpRequestTool.parameters.required).toContain('url');
  });

  it('defines url, method, headers, body, json, timeout properties', () => {
    const props = Object.keys(httpRequestTool.parameters.properties);
    expect(props).toEqual(
      expect.arrayContaining(['url', 'method', 'headers', 'body', 'json', 'timeout'])
    );
  });

  it('lists all valid HTTP methods in enum', () => {
    const methodProp = httpRequestTool.parameters.properties.method;
    expect(methodProp.enum).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  });
});

describe('fetchWebPageTool definition', () => {
  it('has name "fetch_web_page"', () => {
    expect(fetchWebPageTool.name).toBe('fetch_web_page');
  });

  it('requires url', () => {
    expect(fetchWebPageTool.parameters.required).toContain('url');
  });

  it('defines extraction options', () => {
    const props = Object.keys(fetchWebPageTool.parameters.properties);
    expect(props).toEqual(
      expect.arrayContaining([
        'url',
        'extractText',
        'extractLinks',
        'extractMetadata',
        'includeRawHtml',
      ])
    );
  });
});

describe('searchWebTool definition', () => {
  it('has name "search_web"', () => {
    expect(searchWebTool.name).toBe('search_web');
  });

  it('requires query', () => {
    expect(searchWebTool.parameters.required).toContain('query');
  });
});

describe('jsonApiTool definition', () => {
  it('has name "json_api"', () => {
    expect(jsonApiTool.name).toBe('call_json_api');
  });

  it('requires url', () => {
    expect(jsonApiTool.parameters.required).toContain('url');
  });

  it('defines bearerToken property', () => {
    expect(jsonApiTool.parameters.properties.bearerToken).toBeDefined();
  });
});

// =============================================================================
// isBlockedUrl (tested indirectly through executors)
// =============================================================================

describe('URL blocking (isBlockedUrl via httpRequestExecutor)', () => {
  // Each blocked URL should return an error without making a fetch call.

  it.each([
    ['http://localhost/path', 'localhost'],
    ['http://127.0.0.1/foo', 'IPv4 loopback'],
    ['http://0.0.0.0/', 'zero address'],
    ['http://[::1]/test', 'IPv6 loopback'],
    ['http://169.254.1.1/', 'link-local IPv4'],
    ['http://10.0.0.1/', 'private class A'],
    ['http://172.16.0.1/', 'private class B start'],
    ['http://172.31.255.255/', 'private class B end'],
    ['http://192.168.1.1/', 'private class C'],
    ['http://[fc00::1]/', 'IPv6 unique local fc'],
    ['http://[fd12::1]/', 'IPv6 unique local fd'],
    ['http://[fe80::1]/', 'IPv6 link-local'],
  ])('blocks %s (%s)', async (url, _label) => {
    const result = await httpRequestExecutor({ url }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('blocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks file:// protocol', async () => {
    const result = await httpRequestExecutor({ url: 'file:///etc/passwd' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks ftp:// protocol', async () => {
    const result = await httpRequestExecutor({ url: 'ftp://server/file' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks data: protocol', async () => {
    const result = await httpRequestExecutor({ url: 'data:text/html,<h1>hi</h1>' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks URLs with embedded credentials', async () => {
    const result = await httpRequestExecutor({ url: 'http://user:pass@example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks URLs with username only', async () => {
    const result = await httpRequestExecutor({ url: 'http://admin@example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks numeric IP tricks (decimal)', async () => {
    // 2130706433 = 127.0.0.1
    const result = await httpRequestExecutor({ url: 'http://2130706433/' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks numeric IP tricks (hex)', async () => {
    const result = await httpRequestExecutor({ url: 'http://0x7f000001/' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks numeric IP tricks (octal resolving to loopback)', async () => {
    // 017700000001 resolves to 127.0.0.1 via Node URL parser
    const result = await httpRequestExecutor({ url: 'http://017700000001/' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks invalid / unparseable URLs', async () => {
    const result = await httpRequestExecutor({ url: 'not-a-url' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows valid external https URL', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: 'ok' }));
    const result = await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows valid external http URL', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: 'hello' }));
    const result = await httpRequestExecutor({ url: 'http://example.com' }, ctx);
    expect(result.isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks 172.20.x.x through 172.31.x.x range', async () => {
    for (const second of [20, 23, 27, 31]) {
      const result = await httpRequestExecutor({ url: `http://172.${second}.0.1/` }, ctx);
      expect(result.isError).toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not block 172.32.x.x (outside private range)', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: 'ok' }));
    const result = await httpRequestExecutor({ url: 'http://172.32.0.1/' }, ctx);
    expect(result.isError).toBe(false);
  });
});

// =============================================================================
// SSRF via redirect detection
// =============================================================================

describe('SSRF redirect protection', () => {
  it('blocks redirect to localhost', async () => {
    fetchMock.mockResolvedValue(mockResponse({ url: 'http://127.0.0.1/secret', body: 'leaked' }));
    const result = await httpRequestExecutor({ url: 'https://example.com/redirect' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('redirected to a blocked internal address');
  });

  it('blocks redirect to private network in fetchWebPageExecutor', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ url: 'http://192.168.1.1/', ok: true, body: '<html></html>' })
    );
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('redirected');
  });

  it('blocks redirect to private network in jsonApiExecutor', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        url: 'http://10.0.0.1/api',
        ok: true,
        headers: { 'content-type': 'application/json' },
        json: { secret: true },
      })
    );
    const result = await jsonApiExecutor({ url: 'https://example.com/api' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('blocked internal address');
  });

  it('allows redirect to another public URL', async () => {
    fetchMock.mockResolvedValue(mockResponse({ url: 'https://cdn.example.com/page', body: 'ok' }));
    const result = await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(false);
  });

  it('blocks an intermediate 3xx hop to a private IP before following it', async () => {
    // First (and only) hop returns a 302 whose Location points at an internal
    // address. With manual redirect following, the next hop must be rejected
    // BEFORE the second fetch is issued — the platform fetch would have
    // connected to 169.254.169.254 transparently.
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 302,
        statusText: 'Found',
        url: 'https://example.com/redirect',
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      })
    );
    const result = await httpRequestExecutor({ url: 'https://example.com/redirect' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('blocked internal address');
    // The redirect target was never fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/redirect');
  });

  it('follows an intermediate 3xx hop to a public URL and returns the final body', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 302,
          statusText: 'Found',
          url: 'https://example.com/start',
          headers: { location: 'https://cdn.example.com/final' },
        })
      )
      .mockResolvedValueOnce(
        mockResponse({ url: 'https://cdn.example.com/final', body: 'final-body' })
      );
    const result = await httpRequestExecutor({ url: 'https://example.com/start' }, ctx);
    expect(result.isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://cdn.example.com/final');
  });
});

// =============================================================================
// httpRequestExecutor
// =============================================================================

describe('httpRequestExecutor', () => {
  it('defaults method to GET', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: 'hello' }));
    await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('sends custom headers', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: 'ok' }));
    await httpRequestExecutor(
      {
        url: 'https://example.com',
        headers: { 'X-Custom': 'value' },
      },
      ctx
    );
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    expect((callArgs.headers as Record<string, string>)['X-Custom']).toBe('value');
  });

  it('sends JSON body when json param provided', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '{}' }));
    await httpRequestExecutor(
      {
        url: 'https://api.example.com',
        method: 'POST',
        json: { key: 'value' },
      },
      ctx
    );
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callArgs.body).toBe(JSON.stringify({ key: 'value' }));
    expect((callArgs.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends raw string body when body param provided', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: 'ok' }));
    await httpRequestExecutor(
      {
        url: 'https://api.example.com',
        method: 'POST',
        body: 'raw data',
      },
      ctx
    );
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callArgs.body).toBe('raw data');
  });

  it('json param takes precedence over body param', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '{}' }));
    await httpRequestExecutor(
      {
        url: 'https://api.example.com',
        method: 'POST',
        body: 'should be ignored',
        json: { data: 1 },
      },
      ctx
    );
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callArgs.body).toBe(JSON.stringify({ data: 1 }));
  });

  it('parses JSON response when content-type is application/json', async () => {
    const payload = { users: [1, 2, 3] };
    fetchMock.mockResolvedValue(
      mockResponse({
        headers: { 'content-type': 'application/json' },
        json: payload,
      })
    );
    const result = await httpRequestExecutor({ url: 'https://api.example.com' }, ctx);
    expect((result.content as any).body).toEqual(payload);
  });

  it('returns text body for non-JSON content-type', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'text/plain' }, body: 'hello world' })
    );
    const result = await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).body).toBe('hello world');
  });

  it('returns null body for a HEAD request advertising JSON (no parse error)', async () => {
    // HEAD has no body even when content-type says JSON — must not throw.
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, body: '' })
    );
    const result = await httpRequestExecutor(
      { url: 'https://models.dev/api.json', method: 'HEAD' },
      ctx
    );
    expect(result.isError).toBeFalsy();
    expect((result.content as any).body).toBeNull();
  });

  it('returns null body for an empty JSON-labeled response instead of throwing', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, body: '   ' })
    );
    const result = await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBeFalsy();
    expect((result.content as any).body).toBeNull();
  });

  it('returns response headers', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        headers: { 'x-request-id': 'abc123', 'content-type': 'text/plain' },
        body: 'ok',
      })
    );
    const result = await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).headers['x-request-id']).toBe('abc123');
  });

  it('returns status and statusText', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 201, statusText: 'Created', body: '' }));
    const result = await httpRequestExecutor({ url: 'https://example.com', method: 'POST' }, ctx);
    expect((result.content as any).status).toBe(201);
    expect((result.content as any).statusText).toBe('Created');
  });

  it('sets isError=true for non-ok responses (4xx/5xx)', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 404, statusText: 'Not Found', body: 'not found' })
    );
    const result = await httpRequestExecutor({ url: 'https://example.com/missing' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).status).toBe(404);
  });

  it('rejects response larger than content-length limit', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        headers: { 'content-length': String(10 * 1024 * 1024) },
        body: '',
      })
    );
    const result = await httpRequestExecutor({ url: 'https://example.com/big' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('Response too large');
  });

  it('truncates text body exceeding MAX_RESPONSE_SIZE', async () => {
    const largeBody = 'x'.repeat(6 * 1024 * 1024);
    fetchMock.mockResolvedValue(mockResponse({ body: largeBody }));
    const result = await httpRequestExecutor({ url: 'https://example.com/huge' }, ctx);
    expect((result.content as any).body).toContain('[Truncated]');
  });

  it('caps timeout at 30000ms', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: 'ok' }));
    await httpRequestExecutor({ url: 'https://example.com', timeout: 999999 }, ctx);
    // The executor should still call fetch (we cannot directly inspect the timeout value
    // but we can confirm it did not throw).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('defaults timeout to 10000ms', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: 'ok' }));
    await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns timeout error on AbortError', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    fetchMock.mockRejectedValue(abortError);
    const result = await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('timed out');
  });

  it('returns generic error on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toBe('ECONNREFUSED');
  });

  it('uses abort signal for timeout control', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: 'ok' }));
    await httpRequestExecutor({ url: 'https://example.com', timeout: 5000 }, ctx);
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callArgs.signal).toBeInstanceOf(AbortSignal);
  });
});

// =============================================================================
// fetchWebPageExecutor
// =============================================================================

describe('fetchWebPageExecutor', () => {
  const simpleHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test Page</title>
      <meta name="description" content="A test page">
      <meta property="og:title" content="OG Title">
    </head>
    <body>
      <h1>Hello World</h1>
      <p>Some paragraph text.</p>
      <script>var x = 1;</script>
      <style>body { color: red; }</style>
      <a href="/about">About Us</a>
      <a href="https://other.com/page">External Link</a>
    </body>
    </html>`;

  it('blocks internal URLs', async () => {
    const result = await fetchWebPageExecutor({ url: 'http://192.168.0.1' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends correct user-agent and accept headers', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: simpleHtml }));
    await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('OwnPilot');
    expect(headers['Accept']).toContain('text/html');
  });

  it('returns error for non-ok responses', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 503, statusText: 'Service Unavailable', body: '' })
    );
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('503');
  });

  it('extracts text by default (extractText defaults true)', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: simpleHtml }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    const content = result.content as any;
    expect(content.text).toBeDefined();
    expect(content.text).toContain('Hello World');
    expect(content.text).toContain('Some paragraph text');
  });

  it('strips script and style tags from extracted text', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: simpleHtml }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    const content = result.content as any;
    expect(content.text).not.toContain('var x = 1');
    expect(content.text).not.toContain('color: red');
  });

  it('skips text extraction when extractText is false', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: simpleHtml }));
    const result = await fetchWebPageExecutor(
      { url: 'https://example.com', extractText: false },
      ctx
    );
    expect((result.content as any).text).toBeUndefined();
  });

  it('extracts metadata by default', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: simpleHtml }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    const meta = (result.content as any).metadata;
    expect(meta.title).toBe('Test Page');
    expect(meta.description).toBe('A test page');
    expect(meta['og:title']).toBe('OG Title');
  });

  it('skips metadata when extractMetadata is false', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: simpleHtml }));
    const result = await fetchWebPageExecutor(
      {
        url: 'https://example.com',
        extractMetadata: false,
      },
      ctx
    );
    expect((result.content as any).metadata).toBeUndefined();
  });

  it('extracts links when extractLinks is true', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: simpleHtml }));
    const result = await fetchWebPageExecutor(
      {
        url: 'https://example.com',
        extractLinks: true,
      },
      ctx
    );
    const links = (result.content as any).links as Array<{ text: string; href: string }>;
    expect(links.length).toBeGreaterThanOrEqual(2);
    const aboutLink = links.find((l) => l.text === 'About Us');
    expect(aboutLink).toBeDefined();
    expect(aboutLink!.href).toBe('https://example.com/about');
    const externalLink = links.find((l) => l.href === 'https://other.com/page');
    expect(externalLink).toBeDefined();
  });

  it('does not extract links by default', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: simpleHtml }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).links).toBeUndefined();
  });

  it('includes raw HTML when includeRawHtml is true', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: simpleHtml }));
    const result = await fetchWebPageExecutor(
      {
        url: 'https://example.com',
        includeRawHtml: true,
      },
      ctx
    );
    expect((result.content as any).html).toContain('<h1>Hello World</h1>');
  });

  it('does not include raw HTML by default', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: simpleHtml }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).html).toBeUndefined();
  });

  it('truncates extracted text longer than 50000 chars', async () => {
    const longHtml = '<html><body>' + 'word '.repeat(20000) + '</body></html>';
    fetchMock.mockResolvedValue(mockResponse({ body: longHtml }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    const text = (result.content as any).text as string;
    expect(text).toContain('[Content truncated]');
    // The truncated text should be at most ~50020 chars (50000 + suffix)
    expect(text.length).toBeLessThanOrEqual(50100);
  });

  it('truncates raw HTML exceeding 5MB', async () => {
    const hugeHtml = 'x'.repeat(6 * 1024 * 1024);
    fetchMock.mockResolvedValue(mockResponse({ body: hugeHtml }));
    const result = await fetchWebPageExecutor(
      {
        url: 'https://example.com',
        includeRawHtml: true,
      },
      ctx
    );
    const html = (result.content as any).html as string;
    expect(html).toContain('[HTML truncated]');
  });

  it('returns final URL after redirects', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ url: 'https://www.example.com/final', body: '<html></html>' })
    );
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).url).toBe('https://www.example.com/final');
  });

  it('returns timeout error on AbortError', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    fetchMock.mockRejectedValue(abortError);
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('timed out');
  });

  it('returns generic error on fetch failure', async () => {
    fetchMock.mockRejectedValue(new Error('DNS lookup failed'));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toBe('DNS lookup failed');
  });
});

// =============================================================================
// htmlToText (tested through fetchWebPageExecutor)
// =============================================================================

describe('htmlToText (via fetchWebPageExecutor)', () => {
  it('decodes &nbsp; entities', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ body: '<html><body>hello&nbsp;world</body></html>' })
    );
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).text).toContain('hello world');
  });

  it('decodes &amp; entities', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '<html><body>a &amp; b</body></html>' }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).text).toContain('a & b');
  });

  it('decodes &lt; and &gt; entities', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '<html><body>&lt;tag&gt;</body></html>' }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).text).toContain('<tag>');
  });

  it('decodes &quot; and &#39; entities', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ body: '<html><body>&quot;quoted&quot; and &#39;apos&#39;</body></html>' })
    );
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    const text = (result.content as any).text as string;
    expect(text).toContain('"quoted"');
    expect(text).toContain("'apos'");
  });

  it('collapses excess whitespace', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ body: '<html><body>   lots   of   spaces   </body></html>' })
    );
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).text).toBe('lots of spaces');
  });
});

// =============================================================================
// extractLinks (tested through fetchWebPageExecutor)
// =============================================================================

describe('extractLinks (via fetchWebPageExecutor)', () => {
  it('resolves relative URLs against base', async () => {
    const html = '<html><body><a href="/page">Page</a></body></html>';
    fetchMock.mockResolvedValue(mockResponse({ body: html }));
    const result = await fetchWebPageExecutor(
      {
        url: 'https://example.com',
        extractLinks: true,
      },
      ctx
    );
    const links = (result.content as any).links as Array<{ text: string; href: string }>;
    expect(links[0].href).toBe('https://example.com/page');
  });

  it('handles link text with inner HTML tags', async () => {
    const html = '<html><body><a href="/x"><b>Bold Link</b></a></body></html>';
    fetchMock.mockResolvedValue(mockResponse({ body: html }));
    const result = await fetchWebPageExecutor(
      {
        url: 'https://example.com',
        extractLinks: true,
      },
      ctx
    );
    const links = (result.content as any).links as Array<{ text: string; href: string }>;
    expect(links[0].text).toBe('Bold Link');
  });

  it('skips links with invalid href', async () => {
    const html =
      '<html><body><a href="">Empty</a><a href="https://valid.com">Valid</a></body></html>';
    fetchMock.mockResolvedValue(mockResponse({ body: html }));
    const result = await fetchWebPageExecutor(
      {
        url: 'https://example.com',
        extractLinks: true,
      },
      ctx
    );
    const links = (result.content as any).links as Array<{ text: string; href: string }>;
    // The empty href should be skipped (falsy check on href before attempting new URL)
    const validLinks = links.filter((l) => l.href.includes('valid.com'));
    expect(validLinks).toHaveLength(1);
  });
});

// =============================================================================
// extractMetadata (tested through fetchWebPageExecutor)
// =============================================================================

describe('extractMetadata (via fetchWebPageExecutor)', () => {
  it('extracts title tag', async () => {
    const html = '<html><head><title>My Title</title></head><body></body></html>';
    fetchMock.mockResolvedValue(mockResponse({ body: html }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).metadata.title).toBe('My Title');
  });

  it('extracts meta name tags', async () => {
    const html = '<html><head><meta name="author" content="John Doe"></head><body></body></html>';
    fetchMock.mockResolvedValue(mockResponse({ body: html }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).metadata.author).toBe('John Doe');
  });

  it('extracts meta property tags (og:*)', async () => {
    const html =
      '<html><head><meta property="og:image" content="https://img.com/a.jpg"></head><body></body></html>';
    fetchMock.mockResolvedValue(mockResponse({ body: html }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).metadata['og:image']).toBe('https://img.com/a.jpg');
  });

  it('returns empty metadata when no tags found', async () => {
    const html = '<html><head></head><body></body></html>';
    fetchMock.mockResolvedValue(mockResponse({ body: html }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect((result.content as any).metadata).toEqual({});
  });
});

// =============================================================================
// searchWebExecutor
// =============================================================================

describe('searchWebExecutor', () => {
  it('sends encoded query to DuckDuckGo', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '<html></html>' }));
    await searchWebExecutor({ query: 'hello world' }, ctx);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('html.duckduckgo.com');
    expect(calledUrl).toContain('q=hello%20world');
  });

  it('uses default region wt-wt', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '<html></html>' }));
    await searchWebExecutor({ query: 'test' }, ctx);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('kl=wt-wt');
  });

  it('uses custom region', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '<html></html>' }));
    await searchWebExecutor({ query: 'test', region: 'us-en' }, ctx);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('kl=us-en');
  });

  it('returns empty results when no matches found', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '<html><body>No results</body></html>' }));
    const result = await searchWebExecutor({ query: 'test' }, ctx);
    const content = result.content as any;
    expect(content.results).toEqual([]);
    expect(content.resultCount).toBe(0);
    expect(content.query).toBe('test');
    expect(result.isError).toBe(false);
  });

  it('parses DuckDuckGo HTML result blocks', async () => {
    const ddgHtml = `
      <div class="result">
        <a class="result__a" href="https://example.com">Example Title</a>
        <a class="result__snippet">A snippet about example</a>
      </div>
    `;
    fetchMock.mockResolvedValue(mockResponse({ body: ddgHtml }));
    const result = await searchWebExecutor({ query: 'test' }, ctx);
    const content = result.content as any;
    expect(content.results).toHaveLength(1);
    expect(content.results[0].title).toBe('Example Title');
    expect(content.results[0].url).toBe('https://example.com');
    expect(content.results[0].snippet).toBe('A snippet about example');
  });

  it('extracts actual URL from DuckDuckGo uddg redirect parameter', async () => {
    const ddgHtml = `
      <div class="result">
        <a class="result__a" href="/l/?uddg=https%3A%2F%2Freal.example.com%2Fpage&rut=abc">Title</a>
        <a class="result__snippet">Snippet</a>
      </div>
    `;
    fetchMock.mockResolvedValue(mockResponse({ body: ddgHtml }));
    const result = await searchWebExecutor({ query: 'test' }, ctx);
    const content = result.content as any;
    expect(content.results[0].url).toBe('https://real.example.com/page');
  });

  it('respects maxResults limit', async () => {
    // Generate 5 results in DDG format
    let ddgHtml = '<html><body>';
    for (let i = 0; i < 5; i++) {
      ddgHtml += `
        <div class="result">
          <a class="result__a" href="https://example${i}.com">Title ${i}</a>
          <a class="result__snippet">Snippet ${i}</a>
        </div>`;
    }
    ddgHtml += '</body></html>';
    fetchMock.mockResolvedValue(mockResponse({ body: ddgHtml }));
    const result = await searchWebExecutor({ query: 'test', maxResults: 2 }, ctx);
    const content = result.content as any;
    expect(content.results).toHaveLength(2);
  });

  it('defaults maxResults to 10', async () => {
    // Generate 15 results
    let ddgHtml = '<html><body>';
    for (let i = 0; i < 15; i++) {
      ddgHtml += `
        <div class="result">
          <a class="result__a" href="https://example${i}.com">Title ${i}</a>
          <a class="result__snippet">Snippet ${i}</a>
        </div>`;
    }
    ddgHtml += '</body></html>';
    fetchMock.mockResolvedValue(mockResponse({ body: ddgHtml }));
    const result = await searchWebExecutor({ query: 'test' }, ctx);
    const content = result.content as any;
    expect(content.results).toHaveLength(10);
  });

  it('returns error for non-ok response', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 429, statusText: 'Too Many Requests', body: '' })
    );
    const result = await searchWebExecutor({ query: 'test' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('429');
  });

  it('returns timeout error on AbortError', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const result = await searchWebExecutor({ query: 'test' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('timed out');
  });

  it('returns generic error on fetch failure', async () => {
    fetchMock.mockRejectedValue(new Error('Network down'));
    const result = await searchWebExecutor({ query: 'test' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toBe('Network down');
  });

  it('strips HTML from snippet text', async () => {
    const ddgHtml = `
      <div class="result">
        <a class="result__a" href="https://example.com">Title</a>
        <a class="result__snippet">Contains <b>bold</b> and <i>italic</i></a>
      </div>
    `;
    fetchMock.mockResolvedValue(mockResponse({ body: ddgHtml }));
    const result = await searchWebExecutor({ query: 'test' }, ctx);
    const content = result.content as any;
    expect(content.results[0].snippet).toBe('Contains bold and italic');
  });
});

// =============================================================================
// jsonApiExecutor
// =============================================================================

describe('jsonApiExecutor', () => {
  it('blocks internal URLs', async () => {
    const result = await jsonApiExecutor({ url: 'http://localhost/api' }, ctx);
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults method to GET', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, json: {} })
    );
    await jsonApiExecutor({ url: 'https://api.example.com' }, ctx);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('sets Accept and Content-Type to application/json by default', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, json: {} })
    );
    await jsonApiExecutor({ url: 'https://api.example.com' }, ctx);
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Accept']).toBe('application/json');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sets Authorization header from bearerToken', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, json: {} })
    );
    await jsonApiExecutor(
      {
        url: 'https://api.example.com',
        bearerToken: 'my-secret-token',
      },
      ctx
    );
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-token');
  });

  it('does not set Authorization when bearerToken is absent', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, json: {} })
    );
    await jsonApiExecutor({ url: 'https://api.example.com' }, ctx);
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('serializes data as JSON body', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, json: { ok: true } })
    );
    await jsonApiExecutor(
      {
        url: 'https://api.example.com',
        method: 'POST',
        data: { name: 'test', value: 42 },
      },
      ctx
    );
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callArgs.body).toBe(JSON.stringify({ name: 'test', value: 42 }));
  });

  it('does not set body when data is absent', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, json: {} })
    );
    await jsonApiExecutor({ url: 'https://api.example.com' }, ctx);
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callArgs.body).toBeUndefined();
  });

  it('parses JSON response', async () => {
    const payload = { users: ['alice', 'bob'] };
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, json: payload })
    );
    const result = await jsonApiExecutor({ url: 'https://api.example.com/users' }, ctx);
    expect((result.content as any).data).toEqual(payload);
    expect((result.content as any).status).toBe(200);
  });

  it('returns text data when content-type is not JSON', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'text/plain' }, body: 'plain text' })
    );
    const result = await jsonApiExecutor({ url: 'https://api.example.com' }, ctx);
    expect((result.content as any).data).toBe('plain text');
  });

  it('treats a 304 Not Modified (ETag cache hit) as success, not an error', async () => {
    // If-None-Match cache hit: server replies 304 with an empty body. This must
    // be reported as a successful cache-hit, not a JSON parse failure.
    fetchMock.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 304,
        statusText: 'Not Modified',
        headers: { 'content-type': 'application/json' },
        body: '',
      })
    );
    const result = await jsonApiExecutor(
      { url: 'https://models.dev/api.json', headers: { 'If-None-Match': 'W/"abc"' } },
      ctx
    );
    expect(result.isError).toBeFalsy();
    expect((result.content as any).status).toBe(304);
    expect((result.content as any).notModified).toBe(true);
    expect((result.content as any).data).toBeNull();
  });

  it('merges custom headers with defaults', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, json: {} })
    );
    await jsonApiExecutor(
      {
        url: 'https://api.example.com',
        headers: { 'X-Custom': 'hello' },
      },
      ctx
    );
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['X-Custom']).toBe('hello');
    expect(headers['Accept']).toBe('application/json');
  });

  it('allows custom headers to override defaults', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, json: {} })
    );
    await jsonApiExecutor(
      {
        url: 'https://api.example.com',
        headers: { Accept: 'text/xml' },
      },
      ctx
    );
    const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Accept']).toBe('text/xml');
  });

  it('sets isError=true for non-ok response', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'application/json' },
        json: { error: 'invalid token' },
      })
    );
    const result = await jsonApiExecutor(
      {
        url: 'https://api.example.com',
        bearerToken: 'bad-token',
      },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as any).status).toBe(401);
  });

  it('returns timeout error on AbortError', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const result = await jsonApiExecutor({ url: 'https://api.example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('timed out');
  });

  it('returns generic error on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'));
    const result = await jsonApiExecutor({ url: 'https://api.example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toBe('Connection refused');
  });

  it('detects SSRF via redirect', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        url: 'http://169.254.169.254/metadata',
        ok: true,
        headers: { 'content-type': 'application/json' },
        json: { secret: 'aws-credentials' },
      })
    );
    const result = await jsonApiExecutor({ url: 'https://evil.com/redirect' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('blocked internal address');
  });
});

// =============================================================================
// Cross-executor security consistency
// =============================================================================

describe('cross-executor security consistency', () => {
  const blockedUrls = [
    'http://localhost:8080',
    'http://10.0.0.1/admin',
    'ftp://files.internal',
    'http://user:pass@example.com',
  ];

  const executors = [
    { name: 'httpRequestExecutor', fn: httpRequestExecutor, args: (url: string) => ({ url }) },
    { name: 'fetchWebPageExecutor', fn: fetchWebPageExecutor, args: (url: string) => ({ url }) },
    { name: 'jsonApiExecutor', fn: jsonApiExecutor, args: (url: string) => ({ url }) },
  ];

  for (const executor of executors) {
    for (const url of blockedUrls) {
      it(`${executor.name} blocks ${url}`, async () => {
        const result = await executor.fn(executor.args(url), ctx);
        expect(result.isError).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockReset();
      });
    }
  }
});

// =============================================================================
// Edge cases
// =============================================================================

describe('edge cases', () => {
  it('httpRequestExecutor normalizes an empty response body to null', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '' }));
    const result = await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(false);
    expect((result.content as any).body).toBeNull();
  });

  it('httpRequestExecutor handles content-length header of 0', async () => {
    fetchMock.mockResolvedValue(mockResponse({ headers: { 'content-length': '0' }, body: '' }));
    const result = await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(false);
  });

  it('httpRequestExecutor handles missing content-length gracefully', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: 'some data' }));
    const result = await httpRequestExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(false);
  });

  it('fetchWebPageExecutor handles empty HTML', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '' }));
    const result = await fetchWebPageExecutor({ url: 'https://example.com' }, ctx);
    expect(result.isError).toBe(false);
    expect((result.content as any).text).toBe('');
  });

  it('fetchWebPageExecutor handles HTML with no links when extractLinks is true', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '<html><body>No links here</body></html>' }));
    const result = await fetchWebPageExecutor(
      {
        url: 'https://example.com',
        extractLinks: true,
      },
      ctx
    );
    expect((result.content as any).links).toEqual([]);
  });

  it('httpRequestExecutor passes method through to fetch', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      fetchMock.mockResolvedValue(mockResponse({ body: '' }));
      await httpRequestExecutor({ url: 'https://example.com', method }, ctx);
      const callArgs = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit;
      expect(callArgs.method).toBe(method);
    }
  });

  it('jsonApiExecutor passes all HTTP methods through', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      fetchMock.mockResolvedValue(
        mockResponse({ headers: { 'content-type': 'application/json' }, json: {} })
      );
      await jsonApiExecutor({ url: 'https://api.example.com', method }, ctx);
      const callArgs = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit;
      expect(callArgs.method).toBe(method);
    }
  });
});

// =============================================================================
// DNS rebinding protection (isPrivateUrlAsync) in fetchWebPageExecutor / jsonApiExecutor
// =============================================================================

describe('DNS rebinding protection (isPrivateUrlAsync)', () => {
  const mockLookup = vi.mocked(dnsLookup);

  beforeEach(() => {
    // Default: public IP
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
  });

  it('fetchWebPageExecutor blocks when hostname resolves to a private IP', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }] as any);
    const result = await fetchWebPageExecutor({ url: 'https://internal-host.example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('blocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('jsonApiExecutor blocks when hostname resolves to a private IP', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '192.168.1.5', family: 4 }] as any);
    const result = await jsonApiExecutor({ url: 'https://internal-api.example.com' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as any).error).toContain('blocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetchWebPageExecutor allows when hostname resolves to a public IP', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: '<html>ok</html>' }));
    const result = await fetchWebPageExecutor({ url: 'https://public-host.example.com' }, ctx);
    expect(result.isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('jsonApiExecutor allows when hostname resolves to a public IP', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'application/json' }, json: { ok: true } })
    );
    const result = await jsonApiExecutor({ url: 'https://public-api.example.com' }, ctx);
    expect(result.isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// readResponseBodySafely — empty-body / mislabeled-JSON tolerance
// =============================================================================

describe('readResponseBodySafely', () => {
  const resp = (opts: { status?: number; contentType?: string; text?: string }): Response =>
    ({
      status: opts.status ?? 200,
      headers: { get: (n: string) => (n === 'content-type' ? (opts.contentType ?? '') : null) },
      text: () => Promise.resolve(opts.text ?? ''),
    }) as unknown as Response;

  it('returns null for a HEAD request without reading the body', async () => {
    expect(
      await readResponseBodySafely(resp({ contentType: 'application/json' }), 'HEAD')
    ).toBeNull();
  });

  it('returns null for 204 and 304 regardless of method', async () => {
    expect(await readResponseBodySafely(resp({ status: 204 }), 'GET')).toBeNull();
    expect(await readResponseBodySafely(resp({ status: 304 }), 'GET')).toBeNull();
  });

  it('returns null for an empty/whitespace JSON-labeled body', async () => {
    expect(
      await readResponseBodySafely(resp({ contentType: 'application/json', text: '   ' }), 'GET')
    ).toBeNull();
  });

  it('parses a valid JSON body', async () => {
    const out = await readResponseBodySafely(
      resp({ contentType: 'application/json', text: '{"a":1}' }),
      'GET'
    );
    expect(out).toEqual({ a: 1 });
  });

  it('falls back to raw text when JSON is mislabeled (does not throw)', async () => {
    const out = await readResponseBodySafely(
      resp({ contentType: 'application/json', text: 'not json' }),
      'GET'
    );
    expect(out).toBe('not json');
  });

  it('returns raw text for non-JSON content', async () => {
    const out = await readResponseBodySafely(
      resp({ contentType: 'text/plain', text: 'hello' }),
      'GET'
    );
    expect(out).toBe('hello');
  });
});

// =============================================================================
// Self-correction hints: describeHttpStatus / describeNetworkError / parseRetryAfter
// =============================================================================

describe('describeHttpStatus', () => {
  it('gives an auth cue for 401/403', () => {
    expect(describeHttpStatus(401)).toMatch(/bearerToken|Authorization/i);
    expect(describeHttpStatus(403)).toMatch(/scope|permission|restricted/i);
  });

  it('gives a path cue for 404', () => {
    expect(describeHttpStatus(404)).toMatch(/verify the URL path/i);
  });

  it('gives a backoff cue for 429 and 5xx', () => {
    expect(describeHttpStatus(429)).toMatch(/Rate limited|Retry-After/i);
    expect(describeHttpStatus(503)).toMatch(/Server error|transient|backoff/i);
  });

  it('returns empty string for success statuses', () => {
    expect(describeHttpStatus(200)).toBe('');
    expect(describeHttpStatus(301)).toBe('');
  });

  it('falls back to a generic client-error cue for other 4xx', () => {
    expect(describeHttpStatus(418)).toMatch(/Client error/i);
  });
});

describe('describeNetworkError', () => {
  it('classifies DNS failures', () => {
    expect(describeNetworkError('getaddrinfo ENOTFOUND nope.invalid')).toMatch(/DNS/i);
    expect(describeNetworkError('net::ERR_NAME_NOT_RESOLVED')).toMatch(/DNS/i);
  });

  it('classifies connection refused and reset', () => {
    expect(describeNetworkError('connect ECONNREFUSED 1.2.3.4:443')).toMatch(/refused/i);
    expect(describeNetworkError('socket hang up')).toMatch(/reset|transient/i);
  });

  it('classifies TLS/certificate errors', () => {
    expect(describeNetworkError('self-signed certificate in chain')).toMatch(/TLS|certificate/i);
  });

  it('returns empty string for an unrecognized message', () => {
    expect(describeNetworkError('something totally unexpected')).toBe('');
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter('  120 ')).toBe(120);
  });

  it('returns undefined for missing or non-numeric values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
  });
});

describe('jsonApiExecutor error self-correction', () => {
  it('attaches a hint and Retry-After on a 429', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '42' },
        json: { error: 'slow down' },
      })
    );

    const result = await jsonApiExecutor({ url: 'https://api.example.com/x' }, ctx);
    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.status).toBe(429);
    expect(String(content.hint)).toMatch(/Rate limited/i);
    expect(content.retryAfter).toBe(42);
  });

  it('attaches an auth hint on a 401', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: false, status: 401, headers: { 'content-type': 'application/json' } })
    );

    const result = await jsonApiExecutor({ url: 'https://api.example.com/x' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(String(content.hint)).toMatch(/Unauthorized|bearerToken/i);
    expect(content.retryAfter).toBeUndefined();
  });

  it('adds no hint on a 2xx', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        headers: { 'content-type': 'application/json' },
        json: { ok: 1 },
      })
    );

    const result = await jsonApiExecutor({ url: 'https://api.example.com/x' }, ctx);
    expect(result.isError).toBe(false);
    const content = result.content as Record<string, unknown>;
    expect(content.hint).toBeUndefined();
  });

  it('attaches a network hint when fetch itself fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND nope.invalid'));

    const result = await jsonApiExecutor({ url: 'https://nope.invalid/x' }, ctx);
    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(String(content.hint)).toMatch(/DNS/i);
  });
});

describe('httpRequestExecutor error self-correction', () => {
  it('attaches a hint and Retry-After on a 503', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'content-type': 'text/plain', 'retry-after': '10' },
        body: 'down for maintenance',
      })
    );

    const result = await httpRequestExecutor({ url: 'https://example.com/x' }, ctx);
    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.status).toBe(503);
    expect(String(content.hint)).toMatch(/Server error|backoff/i);
    expect(content.retryAfter).toBe(10);
  });
});

describe('httpRequestExecutor 304 Not Modified handling', () => {
  it('treats a 304 (conditional cache hit) as success, not an error', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: false, // .ok is false for 304
        status: 304,
        statusText: 'Not Modified',
        headers: { etag: 'W/"abc"' },
      })
    );

    const result = await httpRequestExecutor(
      { url: 'https://api.example.com/data.json', headers: { 'If-None-Match': 'W/"abc"' } },
      ctx
    );
    expect(result.isError).toBe(false);
    const content = result.content as Record<string, unknown>;
    expect(content.status).toBe(304);
    expect(content.notModified).toBe(true);
    // No misleading error hint on the success path.
    expect(content.hint).toBeUndefined();
  });
});

describe('fetchWebPageExecutor error self-correction', () => {
  it('attaches a status hint and Retry-After on a non-ok page fetch', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        url: 'https://example.com/page',
        headers: { 'retry-after': '15' },
      })
    );

    const result = await fetchWebPageExecutor({ url: 'https://example.com/page' }, ctx);
    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.status).toBe(429);
    expect(String(content.hint)).toMatch(/Rate limited/i);
    expect(content.retryAfter).toBe(15);
  });

  it('attaches a network hint when the page fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED 1.2.3.4:443'));

    const result = await fetchWebPageExecutor({ url: 'https://example.com/page' }, ctx);
    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(String(content.hint)).toMatch(/refused/i);
  });
});
