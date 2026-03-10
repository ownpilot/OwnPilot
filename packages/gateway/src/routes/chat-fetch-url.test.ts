/**
 * Chat Fetch URL Route Tests
 *
 * Tests the /fetch-url endpoint for extracting text content from URLs.
 * Includes SSRF protection testing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// Mock SSRF utils
const mockIsBlockedUrl = vi.fn();
const mockIsPrivateUrlAsync = vi.fn();

vi.mock('../utils/ssrf.js', () => ({
  isBlockedUrl: mockIsBlockedUrl,
  isPrivateUrlAsync: mockIsPrivateUrlAsync,
}));

// Import after mocks
const { chatFetchUrlRoutes } = await import('./chat-fetch-url.js');

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/', chatFetchUrlRoutes);
  app.onError(errorHandler);
  return app;
}

describe('chatFetchUrlRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBlockedUrl.mockReturnValue(false);
    mockIsPrivateUrlAsync.mockResolvedValue(false);
    vi.restoreAllMocks();
  });

  describe('GET /fetch-url', () => {
    it('returns 400 when url parameter is missing', async () => {
      const app = createApp();
      const res = await app.request('/fetch-url');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('url query parameter is required');
    });

    it('returns 400 for invalid URL', async () => {
      const app = createApp();
      const res = await app.request('/fetch-url?url=not-a-valid-url');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('Invalid URL');
    });

    it('returns 400 for non-HTTP protocols', async () => {
      const app = createApp();
      const res = await app.request('/fetch-url?url=file:///etc/passwd');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('Only HTTP/HTTPS URLs');
    });

    it('returns 400 for blocked URLs (SSRF protection)', async () => {
      mockIsBlockedUrl.mockReturnValue(true);

      const app = createApp();
      const res = await app.request('/fetch-url?url=http://localhost/admin');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('URL is not allowed');
    });

    it('returns 400 for private IPs (SSRF protection)', async () => {
      mockIsPrivateUrlAsync.mockResolvedValue(true);

      const app = createApp();
      const res = await app.request('/fetch-url?url=http://192.168.1.1/secret');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('URL is not allowed');
    });

    it('fetches and extracts content from URL', async () => {
      const mockHtml = `
        <html>
          <head><title>Test Page Title</title></head>
          <body>
            <script>alert('xss')</script>
            <style>.hidden { display: none; }</style>
            <h1>Hello World</h1>
            <p>This is test content.</p>
          </body>
        </html>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(mockHtml),
      });

      const app = createApp();
      const res = await app.request('/fetch-url?url=https://example.com/page');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toMatchObject({
        url: 'https://example.com/page',
        title: 'Test Page Title',
      });
      expect(body.data.text).toContain('Hello World');
      expect(body.data.text).toContain('This is test content');
      expect(body.data.text).not.toContain('<script>');
      expect(body.data.text).not.toContain('<style>');
      expect(body.data.charCount).toBeGreaterThan(0);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/page',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          headers: expect.objectContaining({
            'User-Agent': 'OwnPilot/1.0 URL Fetcher',
          }),
        })
      );
    });

    it('handles HTML entity decoding', async () => {
      const mockHtml = `<html><head><title>Test</title></head><body>
        <p>AT&amp;T &lt;test&gt; &quot;quoted&quot; &#39;apostrophe&#39;</p>
      </body></html>`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(mockHtml),
      });

      const app = createApp();
      const res = await app.request('/fetch-url?url=https://example.com');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.text).toContain('AT&T');
      expect(body.data.text).toContain('<test>');
      expect(body.data.text).toContain('"quoted"');
      expect(body.data.text).toContain("'apostrophe'");
    });

    it('uses hostname as title when title tag is missing', async () => {
      const mockHtml = `<html><body><p>No title here</p></body></html>`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(mockHtml),
      });

      const app = createApp();
      const res = await app.request('/fetch-url?url=https://example.com/no-title');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.title).toBe('example.com');
    });

    it('returns 400 when fetch fails with HTTP error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const app = createApp();
      const res = await app.request('/fetch-url?url=https://example.com/notfound');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('404');
    });

    it('returns 400 on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const app = createApp();
      const res = await app.request('/fetch-url?url=https://example.com/error');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('Network error');
    });

    it('truncates text to 50000 characters', async () => {
      const longText = 'a'.repeat(100_000);
      const mockHtml = `<html><head><title>Long</title></head><body>${longText}</body></html>`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(mockHtml),
      });

      const app = createApp();
      const res = await app.request('/fetch-url?url=https://example.com/long');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.charCount).toBeLessThanOrEqual(50_000);
    });

    it('respects URL encoding in query parameter', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue('<html><head><title>Test</title></head><body>Content</body></html>'),
      });

      const app = createApp();
      const encodedUrl = encodeURIComponent('https://example.com/path?q=test&foo=bar');
      const res = await app.request(`/fetch-url?url=${encodedUrl}`);

      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/path?q=test&foo=bar',
        expect.anything()
      );
    });
  });
});
