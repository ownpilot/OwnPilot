/**
 * Shared provider plumbing.
 *
 * The four LLM providers (anthropic, google, openai, openai-compatible) each
 * duplicated three pieces of infrastructure verbatim: the SSE stream reader
 * loop, the boot-time health-check scaffold, and the approximate token
 * counter. They live here once now — provider files keep only the genuinely
 * provider-specific parts (request building, event dispatch, quirk handling).
 */

import { ok } from '../../types/result.js';
import type { Result } from '../../types/result.js';
import type { InternalError } from '../../types/errors.js';
import type { Message } from '../types.js';
import type { ProviderHealthResult } from '../provider-types.js';

// ---------------------------------------------------------------------------
// SSE reader
// ---------------------------------------------------------------------------

/**
 * Read an SSE response body and yield the payload of each `data: ` line
 * (trimmed, empty payloads skipped). Handles chunk buffering across reads and
 * always cancels the reader on exit — including when the consumer `return`s
 * out of its `for await` loop mid-stream (generator finalization runs the
 * `finally`).
 *
 * Protocol markers like `[DONE]` are NOT interpreted here; consumers handle
 * them in their own loop body.
 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        yield data;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already released */
    }
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export interface ProviderHealthCheckTarget {
  providerId: string;
  /** Result of the provider's isReady() — false short-circuits to 'unavailable'. */
  ready: boolean;
  /** Error message when not ready, e.g. 'API key not configured'. */
  notConfiguredError: string;
  /** Issue the probe request. Must pass `signal` through to fetch. */
  request: (signal: AbortSignal) => Promise<Response>;
  /**
   * Treat HTTP 401 as status 'ok' — the endpoint is reachable, the key is
   * just wrong (used by providers whose probe hits an authenticated route).
   */
  authErrorIsOk?: boolean;
}

const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Boot-time provider health check scaffold: 5s timeout, readiness gate,
 * probe request, HTTP status mapping. Never rejects — failures are reported
 * as `status: 'unavailable'` in the result value.
 */
export async function runProviderHealthCheck(
  target: ProviderHealthCheckTarget
): Promise<Result<ProviderHealthResult, InternalError>> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    if (!target.ready) {
      clearTimeout(timeoutId);
      return ok({
        providerId: target.providerId,
        status: 'unavailable',
        error: target.notConfiguredError,
        checkedAt: new Date(),
      });
    }

    const response = await target.request(controller.signal);
    clearTimeout(timeoutId);

    if (response.ok) {
      return ok({
        providerId: target.providerId,
        status: 'ok',
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
      });
    }

    const isAuthOk = (target.authErrorIsOk ?? false) && response.status === 401;
    return ok({
      providerId: target.providerId,
      status: isAuthOk ? 'ok' : 'unavailable',
      error: isAuthOk ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      latencyMs: Date.now() - start,
      checkedAt: new Date(),
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return ok({
      providerId: target.providerId,
      status: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date(),
    });
  }
}

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

/**
 * Approximate token count for a message list (~4 chars per token). Shared by
 * every provider's countTokens().
 */
export function approximateTokenCount(messages: readonly Message[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else {
      for (const part of msg.content) {
        if (part.type === 'text') {
          totalChars += part.text.length;
        }
      }
    }
  }
  return Math.ceil(totalChars / 4);
}
