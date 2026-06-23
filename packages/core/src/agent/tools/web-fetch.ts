/**
 * Web Fetch Tools
 * HTTP requests, web scraping, and API interactions
 */

import type { ToolContext, ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';
import { isPrivateUrlAsync } from './dynamic-tool-permissions.js';

/**
 * Short-circuit a tool call when the caller's AbortSignal has fired. The
 * agent cancel() flow plumbs the per-turn signal into ToolContext.signal;
 * this helper lets each executor bail out before starting work.
 */
function cancelledResult(context: ToolContext | undefined): ToolExecutionResult | null {
  if (context?.signal?.aborted) {
    return { content: { error: 'Tool execution cancelled' }, isError: true };
  }
  return null;
}

/**
 * Escape HTML entities to prevent XSS
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Security: Maximum response size (5MB)
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

// Security: Request timeout (30 seconds)
const REQUEST_TIMEOUT = 30000;

/**
 * Read a fetch Response body without throwing on a legitimately empty payload.
 *
 * A HEAD request, a 204 No Content, and a 304 Not Modified all carry no body by
 * spec — yet the server often still advertises `content-type: application/json`.
 * Calling `response.json()` on that empty payload throws "Unexpected end of JSON
 * input", which surfaced as a hard tool failure for agents doing the *right*
 * thing: HEAD for change-detection and `If-None-Match` ETag caching (every
 * cache-hit returns 304). Returns `null` for an empty body, the parsed object for
 * JSON, and raw text otherwise — and falls back to raw text if a server mislabels
 * non-JSON as JSON rather than throwing.
 */
export async function readResponseBodySafely(response: Response, method: string): Promise<unknown> {
  if (method.toUpperCase() === 'HEAD' || response.status === 204 || response.status === 304) {
    return null;
  }
  const text = await response.text();
  if (text.trim() === '') {
    return null;
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Turn an HTTP error status into a short, actionable cue so the agent corrects
 * its next attempt instead of blindly re-issuing the same failing request. A
 * bare `{status: 401}` tells the model nothing it can act on; "supply a token"
 * does. Empty string for 2xx/3xx (no hint needed). Exported for unit testing.
 */
export function describeHttpStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Unauthorized — supply a valid bearerToken or Authorization header; existing credentials may be missing or expired.';
    case 403:
      return 'Forbidden — the credential may lack the required scope/permission, or the resource is access-restricted.';
    case 404:
      return 'Not found — verify the URL path and any path/query parameters before retrying.';
    case 405:
      return 'Method not allowed — this endpoint rejects the HTTP method used; try a different method.';
    case 408:
      return 'Request timeout — the server gave up waiting; retry the request.';
    case 409:
      return 'Conflict — the resource state prevents this operation; re-read it before retrying.';
    case 410:
      return 'Gone — the resource was permanently removed; do not retry this URL.';
    case 422:
      return 'Unprocessable entity — the request body failed validation; check required fields and value types.';
    case 429:
      return 'Rate limited — back off before retrying and honor the Retry-After header if present.';
    default:
      if (status >= 500)
        return 'Server error (upstream) — typically transient; retry with backoff. This is not caused by your request shape.';
      if (status >= 400)
        return 'Client error — re-check the URL, method, headers, and request body.';
      return '';
  }
}

/**
 * Classify a low-level fetch failure (no HTTP response was produced) into an
 * actionable cue. Returns '' when the message is unrecognized. Exported for
 * unit testing.
 */
export function describeNetworkError(message: string): string {
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(message))
    return 'DNS lookup failed — verify the hostname is spelled correctly and is reachable.';
  if (/ECONNREFUSED/i.test(message))
    return 'Connection refused — the server may be down or the port/scheme wrong.';
  if (/ECONNRESET|socket hang up/i.test(message))
    return 'Connection reset — transient; retry the request.';
  if (/certificate|self-signed|\bTLS\b|\bSSL\b|ERR_CERT/i.test(message))
    return 'TLS/certificate error — the endpoint presented an invalid or untrusted certificate.';
  if (/fetch failed|network|ECONNABORTED/i.test(message))
    return 'Network request failed — check connectivity and the URL.';
  return '';
}

/** Parse a Retry-After header (delta-seconds form) into a number, or undefined. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value.trim(), 10);
  return Number.isNaN(n) ? undefined : n;
}

// Security: Blocked domains (internal/dangerous)
const BLOCKED_DOMAINS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.', // Link-local IPv4
  '10.', // Private Class A
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.', // Private Class B
  '192.168.', // Private Class C
  '[::1]', // IPv6 loopback (bracketed in URLs)
  '[fc', // IPv6 unique local (fc00::/7)
  '[fd', // IPv6 unique local (fd00::/8)
  '[fe80', // IPv6 link-local (fe80::/10)
];

/**
 * Check if URL is blocked (exported for reuse in file-system download_file)
 */
export function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Block non-http(s) schemes (file://, ftp://, data://, etc.)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return true;
    }

    // Block URLs with credentials (user:pass@host)
    if (parsed.username || parsed.password) {
      return true;
    }

    // Block numeric IP tricks (decimal, octal, hex representations of private IPs)
    // e.g. 2130706433 = 127.0.0.1, 0x7f000001 = 127.0.0.1
    if (/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(hostname)) {
      return true; // Block all numeric-only hostnames
    }

    // Standard domain/IP checks
    return BLOCKED_DOMAINS.some((blocked) => {
      if (blocked.endsWith('.')) {
        return hostname.startsWith(blocked);
      }
      if (blocked.startsWith('[')) {
        // IPv6 prefix match (bracketed form in URLs)
        return hostname.startsWith(blocked);
      }
      return hostname === blocked || hostname.endsWith('.' + blocked);
    });
  } catch {
    return true; // Block invalid URLs
  }
}

/**
 * Validate the final URL after redirects to prevent SSRF via open redirects.
 * Returns an error message if blocked, or null if safe.
 */
async function checkRedirectTarget(finalUrl: string, originalUrl: string): Promise<string | null> {
  if (isBlockedUrl(finalUrl) || (await isPrivateUrlAsync(finalUrl))) {
    return `Request was redirected to a blocked internal address (${finalUrl}). Original URL: ${originalUrl}`;
  }
  return null;
}

/** Maximum redirect hops followed by `safeFetch` before giving up. */
const MAX_REDIRECTS = 5;

/**
 * SSRF-safe `fetch` that follows redirects MANUALLY, re-validating every
 * intermediate hop against the block-list — not just the final URL.
 *
 * The platform `fetch` follows 3xx transparently and exposes only the final
 * `response.url`, so a URL that 302-redirects to 169.254.169.254 or an RFC1918
 * host is connected to before any post-fetch check can run (CWE-918). Here each
 * `Location` is resolved relative to the current hop, checked with
 * `isBlockedUrl` + DNS-rebinding-aware `isPrivateUrlAsync`, and only then
 * followed. A blocked hop (or exceeding MAX_REDIRECTS) throws a plain Error
 * whose message is surfaced by the caller's existing catch as a tool error.
 *
 * Redirect method/body rewriting mirrors the Fetch spec: 303 (and 301/302 for
 * non-GET/HEAD) downgrade to GET with the body dropped; 307/308 preserve both.
 */
export async function safeFetch(initialUrl: string, init: RequestInit = {}): Promise<Response> {
  let currentUrl = initialUrl;
  let method = (init.method ?? 'GET').toUpperCase();
  let body = init.body;

  for (let hops = 0; ; hops++) {
    const response = await fetch(currentUrl, { ...init, method, body, redirect: 'manual' });

    // Not a redirect (or a 3xx with no Location) → terminal response.
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;

    if (hops >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects (>${MAX_REDIRECTS}) starting from ${initialUrl}`);
    }

    const nextUrl = new URL(location, currentUrl).href;
    if (isBlockedUrl(nextUrl) || (await isPrivateUrlAsync(nextUrl))) {
      throw new Error(
        `Request was redirected to a blocked internal address (${nextUrl}). Original URL: ${initialUrl}`
      );
    }

    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method !== 'GET' &&
        method !== 'HEAD')
    ) {
      method = 'GET';
      body = undefined;
    }
    currentUrl = nextUrl;
  }
}

/**
 * Parse HTML and extract text content
 */
function htmlToText(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Extract links from HTML
 */
const LINK_REGEX = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi;

function extractLinks(html: string, baseUrl: string): Array<{ text: string; href: string }> {
  const links: Array<{ text: string; href: string }> = [];
  LINK_REGEX.lastIndex = 0;

  let match;
  while ((match = LINK_REGEX.exec(html)) !== null) {
    const href = match[2];
    const text = match[3]?.replace(/<[^>]+>/g, '').trim() || '';

    if (href) {
      try {
        const absoluteUrl = new URL(href, baseUrl).href;
        links.push({ text, href: absoluteUrl });
      } catch {
        // Skip invalid URLs
      }
    }
  }

  return links;
}

/**
 * Extract metadata from HTML with XSS protection
 */
function extractMetadata(html: string): Record<string, string> {
  const metadata: Record<string, string> = {};

  // Title
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    metadata.title = escapeHtml(titleMatch[1].trim());
  }

  // Meta tags
  const metaRegex =
    /<meta\s+(?:[^>]*?\s+)?(?:name|property)=(["'])(.*?)\1\s+content=(["'])(.*?)\3[^>]*>/gi;
  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    const name = match[2]?.toLowerCase();
    const content = match[4];
    if (name && content) {
      metadata[name] = escapeHtml(content);
    }
  }

  return metadata;
}

// ============================================================================
// HTTP REQUEST TOOL
// ============================================================================

export const httpRequestTool: ToolDefinition = {
  name: 'http_request',
  brief: 'Make HTTP requests (GET, POST, PUT, DELETE)',
  description:
    'Make HTTP requests to external APIs and websites. Supports GET, POST, PUT, PATCH, DELETE methods.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to request',
      },
      method: {
        type: 'string',
        description: 'HTTP method',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      },
      headers: {
        type: 'object',
        description:
          'Request headers as key-value pairs, e.g. {"Authorization": "Bearer xxx", "Accept": "application/json"}',
      },
      body: {
        type: 'string',
        description:
          'Request body as raw string (for POST, PUT, PATCH). Use "json" instead for JSON payloads.',
      },
      json: {
        type: 'object',
        description:
          'JSON body object (automatically sets Content-Type to application/json). Use this OR "body", not both.',
      },
      timeout: {
        type: 'number',
        description: 'Request timeout in milliseconds (default: 10000, max: 30000)',
      },
    },
    required: ['url'],
  },
};

export const httpRequestExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const url = params.url as string;
  const method = (params.method as string) || 'GET';
  const headers = (params.headers as Record<string, string>) || {};
  const body = params.body as string | undefined;
  const json = params.json as Record<string, unknown> | undefined;
  const timeout = Math.min((params.timeout as number) || 10000, REQUEST_TIMEOUT);

  // Security check with DNS rebinding protection
  if (isBlockedUrl(url) || (await isPrivateUrlAsync(url))) {
    return {
      content: { error: 'This URL is blocked for security reasons (internal/private network)' },
      isError: true,
    };
  }

  try {
    const requestHeaders: Record<string, string> = { ...headers };
    let requestBody: string | undefined;

    if (json) {
      requestHeaders['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(json);
    } else if (body) {
      requestBody = body;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response: Response;
    try {
      response = await safeFetch(url, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Check if redirect landed on a blocked internal address
    const redirectError = await checkRedirectTarget(response.url, url);
    if (redirectError) {
      return { content: { error: redirectError }, isError: true };
    }

    // Get response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Check content length
    const contentLength = parseInt(responseHeaders['content-length'] || '0', 10);
    if (contentLength > MAX_RESPONSE_SIZE) {
      return {
        content: {
          error: `Response too large: ${contentLength} bytes (max ${MAX_RESPONSE_SIZE})`,
          status: response.status,
          headers: responseHeaders,
        },
        isError: true,
      };
    }

    // Read response body — tolerant of empty payloads (HEAD / 204 / 304) and of
    // servers that mislabel non-JSON as application/json.
    let responseBody = await readResponseBodySafely(response, method);
    if (typeof responseBody === 'string' && responseBody.length > MAX_RESPONSE_SIZE) {
      responseBody = responseBody.slice(0, MAX_RESPONSE_SIZE) + '\n\n... [Truncated]';
    }

    // 304 Not Modified is the success path for a conditional request
    // (If-None-Match / If-Modified-Since) — the agent's cached copy is still
    // valid. `response.ok` is false for 304, so without this it would be
    // mis-reported as a failure even though the ETag cache-hit is exactly what
    // the agent wanted. Mirrors call_json_api's handling.
    const notModified = response.status === 304;
    const errored = !response.ok && !notModified;
    const hint = errored ? describeHttpStatus(response.status) : '';
    const retryAfter = errored ? parseRetryAfter(response.headers.get('retry-after')) : undefined;

    return {
      content: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        ...(notModified ? { notModified: true } : {}),
        ...(hint ? { hint } : {}),
        ...(retryAfter !== undefined ? { retryAfter } : {}),
      },
      isError: errored,
    };
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      return {
        content: { error: `Request timed out after ${timeout}ms` },
        isError: true,
      };
    }
    const netHint = describeNetworkError(err.message);
    return {
      content: { error: err.message, ...(netHint ? { hint: netHint } : {}) },
      isError: true,
    };
  }
};

// ============================================================================
// FETCH WEB PAGE TOOL
// ============================================================================

export const fetchWebPageTool: ToolDefinition = {
  name: 'fetch_web_page',
  brief: 'Fetch a web page and extract text content',
  description: 'Fetch a web page and extract its content, metadata, and links',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL of the web page to fetch',
      },
      extractText: {
        type: 'boolean',
        description: 'Extract plain text content from HTML',
      },
      extractLinks: {
        type: 'boolean',
        description: 'Extract all links from the page',
      },
      extractMetadata: {
        type: 'boolean',
        description: 'Extract page metadata (title, description, etc.)',
      },
      includeRawHtml: {
        type: 'boolean',
        description: 'Include raw HTML in response',
      },
    },
    required: ['url'],
  },
};

export const fetchWebPageExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const url = params.url as string;
  const shouldExtractText = params.extractText !== false;
  const shouldExtractLinks = params.extractLinks === true;
  const shouldExtractMetadata = params.extractMetadata !== false;
  const includeRawHtml = params.includeRawHtml === true;

  // Security check — same dual check as http_request (SSRF + DNS rebinding)
  if (isBlockedUrl(url) || (await isPrivateUrlAsync(url))) {
    return {
      content: { error: 'This URL is blocked for security reasons (internal/private network)' },
      isError: true,
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    let response: Response;
    try {
      response = await safeFetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OwnPilot/1.0; +https://github.com/ownpilot)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Check if redirect landed on a blocked internal address
    const redirectError = await checkRedirectTarget(response.url, url);
    if (redirectError) {
      return { content: { error: redirectError }, isError: true };
    }

    if (!response.ok) {
      const hint = describeHttpStatus(response.status);
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      return {
        content: {
          status: response.status,
          statusText: response.statusText,
          error: `HTTP ${response.status}: ${response.statusText}`,
          ...(hint ? { hint } : {}),
          ...(retryAfter !== undefined ? { retryAfter } : {}),
        },
        isError: true,
      };
    }

    const html = await response.text();

    const result: Record<string, unknown> = {
      url: response.url, // Final URL after redirects
      status: response.status,
    };

    if (shouldExtractMetadata) {
      result.metadata = extractMetadata(html);
    }

    if (shouldExtractText) {
      let text = htmlToText(html);
      if (text.length > 50000) {
        text = text.slice(0, 50000) + '\n\n... [Content truncated]';
      }
      result.text = text;
    }

    if (shouldExtractLinks) {
      result.links = extractLinks(html, url);
    }

    if (includeRawHtml) {
      result.html =
        html.length > MAX_RESPONSE_SIZE
          ? html.slice(0, MAX_RESPONSE_SIZE) + '\n\n... [HTML truncated]'
          : html;
    }

    return { content: result, isError: false };
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      return {
        content: { error: `Request timed out after ${REQUEST_TIMEOUT}ms` },
        isError: true,
      };
    }
    const netHint = describeNetworkError(err.message);
    return {
      content: { error: err.message, ...(netHint ? { hint: netHint } : {}) },
      isError: true,
    };
  }
};

// ============================================================================
// SEARCH WEB TOOL (using DuckDuckGo)
// ============================================================================

export const searchWebTool: ToolDefinition = {
  name: 'search_web',
  brief: 'Search the web via DuckDuckGo',
  description:
    'Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10)',
      },
      region: {
        type: 'string',
        description: 'Region for search results (e.g., "us-en", "uk-en", "tr-tr")',
      },
    },
    required: ['query'],
  },
};

export const searchWebExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const query = params.query as string;
  const maxResults = (params.maxResults as number) || 10;
  const region = (params.region as string) || 'wt-wt';

  try {
    // Use DuckDuckGo HTML search (no API key needed)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${region}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        content: { error: `Search failed: HTTP ${response.status}` },
        isError: true,
      };
    }

    const html = await response.text();

    // Parse search results from DuckDuckGo HTML
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Match result blocks
    const resultRegex =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const matchedUrl = match[1];
      const title = match[2]?.trim() || '';
      const snippet = match[3]?.replace(/<[^>]+>/g, '').trim() || '';

      if (matchedUrl) {
        // Extract actual URL from DuckDuckGo redirect
        const actualUrlMatch = matchedUrl.match(/uddg=([^&]+)/);
        const actualUrl = actualUrlMatch
          ? decodeURIComponent(actualUrlMatch[1] || matchedUrl)
          : matchedUrl;

        results.push({ title, url: actualUrl, snippet });
      }
    }

    return {
      content: {
        query,
        results,
        resultCount: results.length,
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      return {
        content: { error: `Search timed out after ${REQUEST_TIMEOUT}ms` },
        isError: true,
      };
    }
    return {
      content: { error: err.message },
      isError: true,
    };
  }
};

// ============================================================================
// JSON API TOOL
// ============================================================================

export const jsonApiTool: ToolDefinition = {
  name: 'call_json_api',
  brief: 'Make a JSON API request with auto-serialization',
  description:
    'Simplified tool for making JSON API requests. Automatically handles JSON serialization.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The API endpoint URL',
      },
      method: {
        type: 'string',
        description: 'HTTP method',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      },
      data: {
        type: 'object',
        description: 'JSON data to send in request body',
      },
      headers: {
        type: 'object',
        description: 'Additional headers as key-value pairs, e.g. {"X-Custom": "value"}',
      },
      bearerToken: {
        type: 'string',
        description: 'Bearer token for Authorization header',
      },
    },
    required: ['url'],
  },
};

export const jsonApiExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const url = params.url as string;
  const method = (params.method as string) || 'GET';
  const data = params.data as Record<string, unknown> | undefined;
  const headers = (params.headers as Record<string, string>) || {};
  const bearerToken = params.bearerToken as string | undefined;

  // Security check — dual check same as http_request (SSRF + DNS rebinding)
  if (isBlockedUrl(url) || (await isPrivateUrlAsync(url))) {
    return {
      content: { error: 'This URL is blocked for security reasons (internal/private network)' },
      isError: true,
    };
  }

  try {
    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    };

    if (bearerToken) {
      requestHeaders['Authorization'] = `Bearer ${bearerToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    let response: Response;
    try {
      response = await safeFetch(url, {
        method,
        headers: requestHeaders,
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Check if redirect landed on a blocked internal address
    const redirectError = await checkRedirectTarget(response.url, url);
    if (redirectError) {
      return { content: { error: redirectError }, isError: true };
    }

    // Tolerant body read: HEAD / 204 / 304 carry no body, and the most common
    // caller pattern here is If-None-Match ETag caching whose cache-hit is a 304.
    const responseData = await readResponseBodySafely(response, method);

    // 304 Not Modified is a success for a caching client — it means "your cached
    // copy is still valid", not a failure. Flag it explicitly so the agent knows
    // to reuse its cache instead of treating the empty body as an error.
    const notModified = response.status === 304;
    const errored = !response.ok && !notModified;

    // Self-correction cue + Retry-After surfacing for error statuses.
    const hint = errored ? describeHttpStatus(response.status) : '';
    const retryAfter = errored ? parseRetryAfter(response.headers.get('retry-after')) : undefined;

    return {
      content: {
        status: response.status,
        ...(notModified ? { notModified: true } : {}),
        ...(hint ? { hint } : {}),
        ...(retryAfter !== undefined ? { retryAfter } : {}),
        data: responseData,
      },
      isError: errored,
    };
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      return {
        content: { error: `Request timed out after ${REQUEST_TIMEOUT}ms` },
        isError: true,
      };
    }
    const netHint = describeNetworkError(err.message);
    return {
      content: { error: err.message, ...(netHint ? { hint: netHint } : {}) },
      isError: true,
    };
  }
};

// ============================================================================
// EXPORT ALL WEB FETCH TOOLS
// ============================================================================

export const WEB_FETCH_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: httpRequestTool, executor: httpRequestExecutor },
  { definition: fetchWebPageTool, executor: fetchWebPageExecutor },
  { definition: searchWebTool, executor: searchWebExecutor },
  { definition: jsonApiTool, executor: jsonApiExecutor },
];
