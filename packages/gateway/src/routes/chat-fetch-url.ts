/**
 * Chat — Fetch URL Route
 *
 * GET /fetch-url endpoint for extracting text content from URLs.
 * Used by the ToolPicker URL tab in the frontend.
 */

import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES } from './helpers.js';
import { isBlockedUrl, isPrivateUrlAsync } from '../utils/ssrf.js';

export const chatFetchUrlRoutes = new Hono();

/**
 * Fetch and extract text content from a URL (for ToolPicker URL tab)
 */
chatFetchUrlRoutes.get('/fetch-url', async (c) => {
  const rawUrl = c.req.query('url');
  if (!rawUrl) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'url query parameter is required' },
      400
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Only HTTP/HTTPS URLs are supported' },
        400
      );
    }
  } catch {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid URL' }, 400);
  }

  // SSRF protection: block private IPs and DNS-rebinding attacks
  if (isBlockedUrl(rawUrl) || (await isPrivateUrlAsync(rawUrl))) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'URL is not allowed' }, 400);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(parsedUrl.href, {
      signal: controller.signal,
      headers: { 'User-Agent': 'OwnPilot/1.0 URL Fetcher', Accept: 'text/html,text/plain,*/*' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return apiError(
        c,
        { code: ERROR_CODES.FETCH_FAILED, message: `Server responded with HTTP ${resp.status}` },
        400
      );
    }

    const html = await resp.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1]!.trim().replace(/\s+/g, ' ') : parsedUrl.hostname;

    // Strip scripts/styles, then all tags, decode entities, collapse whitespace
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{3,}/g, '\n\n')
      .trim()
      .slice(0, 50_000);

    return apiResponse(c, { url: parsedUrl.href, title, text, charCount: text.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch URL';
    return apiError(c, { code: ERROR_CODES.FETCH_FAILED, message }, 400);
  }
});
