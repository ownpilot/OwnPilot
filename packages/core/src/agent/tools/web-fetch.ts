/**
 * Web Fetch Tools
 * HTTP requests, web scraping, and API interactions
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';

// Security: Maximum response size (5MB)
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

// Security: Request timeout (30 seconds)
const REQUEST_TIMEOUT = 30000;

// Security: Blocked domains (internal/dangerous)
const BLOCKED_DOMAINS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.',  // Link-local IPv4
  '10.',       // Private Class A
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.', // Private Class B
  '192.168.', // Private Class C
  '[::1]',    // IPv6 loopback (bracketed in URLs)
  '[fc',      // IPv6 unique local (fc00::/7)
  '[fd',      // IPv6 unique local (fd00::/8)
  '[fe80',    // IPv6 link-local (fe80::/10)
];

/**
 * Check if URL is blocked
 */
function isBlockedUrl(url: string): boolean {
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
function checkRedirectTarget(finalUrl: string, originalUrl: string): string | null {
  if (isBlockedUrl(finalUrl)) {
    return `Request was redirected to a blocked internal address (${finalUrl}). Original URL: ${originalUrl}`;
  }
  return null;
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
 * Extract metadata from HTML
 */
function extractMetadata(html: string): Record<string, string> {
  const metadata: Record<string, string> = {};

  // Title
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    metadata.title = titleMatch[1].trim();
  }

  // Meta tags
  const metaRegex = /<meta\s+(?:[^>]*?\s+)?(?:name|property)=(["'])(.*?)\1\s+content=(["'])(.*?)\3[^>]*>/gi;
  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    const name = match[2]?.toLowerCase();
    const content = match[4];
    if (name && content) {
      metadata[name] = content;
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
  description: 'Make HTTP requests to external APIs and websites. Supports GET, POST, PUT, PATCH, DELETE methods.',
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
        description: 'Request headers as key-value pairs, e.g. {"Authorization": "Bearer xxx", "Accept": "application/json"}',
      },
      body: {
        type: 'string',
        description: 'Request body as raw string (for POST, PUT, PATCH). Use "json" instead for JSON payloads.',
      },
      json: {
        type: 'object',
        description: 'JSON body object (automatically sets Content-Type to application/json). Use this OR "body", not both.',
      },
      timeout: {
        type: 'number',
        description: 'Request timeout in milliseconds (default: 10000, max: 30000)',
      },
    },
    required: ['url'],
  },
};

export const httpRequestExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const url = params.url as string;
  const method = (params.method as string) || 'GET';
  const headers = (params.headers as Record<string, string>) || {};
  const body = params.body as string | undefined;
  const json = params.json as Record<string, unknown> | undefined;
  const timeout = Math.min((params.timeout as number) || 10000, REQUEST_TIMEOUT);

  // Security check
  if (isBlockedUrl(url)) {
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

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check if redirect landed on a blocked internal address
    const redirectError = checkRedirectTarget(response.url, url);
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

    // Read response body
    const contentType = responseHeaders['content-type'] || '';
    let responseBody: unknown;

    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      let textBody = await response.text();
      if (textBody.length > MAX_RESPONSE_SIZE) {
        textBody = textBody.slice(0, MAX_RESPONSE_SIZE) + '\n\n... [Truncated]';
      }
      responseBody = textBody;
    }

    return {
      content: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
      },
      isError: !response.ok,
    };
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      return {
        content: { error: `Request timed out after ${timeout}ms` },
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

export const fetchWebPageExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const url = params.url as string;
  const shouldExtractText = params.extractText !== false;
  const shouldExtractLinks = params.extractLinks === true;
  const shouldExtractMetadata = params.extractMetadata !== false;
  const includeRawHtml = params.includeRawHtml === true;

  // Security check
  if (isBlockedUrl(url)) {
    return {
      content: { error: 'This URL is blocked for security reasons (internal/private network)' },
      isError: true,
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OwnPilot/1.0; +https://github.com/ownpilot)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check if redirect landed on a blocked internal address
    const redirectError = checkRedirectTarget(response.url, url);
    if (redirectError) {
      return { content: { error: redirectError }, isError: true };
    }

    if (!response.ok) {
      return {
        content: {
          status: response.status,
          statusText: response.statusText,
          error: `HTTP ${response.status}: ${response.statusText}`,
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
      result.html = html.length > MAX_RESPONSE_SIZE
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
    return {
      content: { error: err.message },
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
  description: 'Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets.',
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

export const searchWebExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
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
        'Accept': 'text/html',
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
    const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const matchedUrl = match[1];
      const title = match[2]?.trim() || '';
      const snippet = match[3]?.replace(/<[^>]+>/g, '').trim() || '';

      if (matchedUrl) {
        // Extract actual URL from DuckDuckGo redirect
        const actualUrlMatch = matchedUrl.match(/uddg=([^&]+)/);
        const actualUrl = actualUrlMatch ? decodeURIComponent(actualUrlMatch[1] || matchedUrl) : matchedUrl;

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
  description: 'Simplified tool for making JSON API requests. Automatically handles JSON serialization.',
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

export const jsonApiExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const url = params.url as string;
  const method = (params.method as string) || 'GET';
  const data = params.data as Record<string, unknown> | undefined;
  const headers = (params.headers as Record<string, string>) || {};
  const bearerToken = params.bearerToken as string | undefined;

  // Security check
  if (isBlockedUrl(url)) {
    return {
      content: { error: 'This URL is blocked for security reasons (internal/private network)' },
      isError: true,
    };
  }

  try {
    const requestHeaders: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    };

    if (bearerToken) {
      requestHeaders['Authorization'] = `Bearer ${bearerToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: data ? JSON.stringify(data) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check if redirect landed on a blocked internal address
    const redirectError = checkRedirectTarget(response.url, url);
    if (redirectError) {
      return { content: { error: redirectError }, isError: true };
    }

    let responseData: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    return {
      content: {
        status: response.status,
        data: responseData,
      },
      isError: !response.ok,
    };
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      return {
        content: { error: `Request timed out after ${REQUEST_TIMEOUT}ms` },
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
// EXPORT ALL WEB FETCH TOOLS
// ============================================================================

export const WEB_FETCH_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: httpRequestTool, executor: httpRequestExecutor },
  { definition: fetchWebPageTool, executor: fetchWebPageExecutor },
  { definition: searchWebTool, executor: searchWebExecutor },
  { definition: jsonApiTool, executor: jsonApiExecutor },
];
