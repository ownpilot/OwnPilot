import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { approximateTokenCount, readSseData, runProviderHealthCheck } from './shared.js';
import type { Message } from '../types.js';
import type { ProviderHealthCheckTarget } from './shared.js';

// =============================================================================
// approximateTokenCount
// =============================================================================

describe('approximateTokenCount', () => {
  it('estimates string content as chars/4', () => {
    const messages: Message[] = [{ role: 'user', content: 'a'.repeat(40) }];
    expect(approximateTokenCount(messages)).toBe(10);
  });

  it('sums text parts of structured content', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a'.repeat(20) },
          { type: 'text', text: 'b'.repeat(20) },
        ],
      },
    ];
    expect(approximateTokenCount(messages)).toBe(10);
  });

  it('ignores non-text parts (images/files), counting only text', () => {
    const mixed: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a'.repeat(40) },
          { type: 'image', data: 'base64data', mediaType: 'image/png' },
          { type: 'file', name: 'a.txt', data: 'x'.repeat(40), mimeType: 'text/plain' },
        ],
      },
    ];
    // Only the 40 text chars count → 10 tokens; image/file parts are ignored
    // (matches the documented countTokens behavior across providers).
    expect(approximateTokenCount(mixed)).toBe(10);
  });

  it('returns 0 for empty input', () => {
    expect(approximateTokenCount([])).toBe(0);
  });
});

// =============================================================================
// readSseData
// =============================================================================

describe('readSseData', () => {
  function createStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  it('yields data lines from SSE stream', async () => {
    const stream = createStream(['data: hello\n\n', 'data: world\n\n']);
    const results: string[] = [];
    for await (const data of readSseData(stream)) {
      results.push(data);
    }
    expect(results).toEqual(['hello', 'world']);
  });

  it('skips lines without data: prefix', async () => {
    const stream = createStream(['event: ping\n', 'data: payload\n\n']);
    const results: string[] = [];
    for await (const data of readSseData(stream)) {
      results.push(data);
    }
    expect(results).toEqual(['payload']);
  });

  it('handles chunked SSE across buffer boundaries', async () => {
    const stream = createStream(['data: hel', 'lo\n\n']);
    const results: string[] = [];
    for await (const data of readSseData(stream)) {
      results.push(data);
    }
    expect(results).toEqual(['hello']);
  });

  it('skips empty data lines', async () => {
    const stream = createStream(['data: \n\n', 'data: value\n\n']);
    const results: string[] = [];
    for await (const data of readSseData(stream)) {
      results.push(data);
    }
    expect(results).toEqual(['value']);
  });

  it('flushes final line when stream ends without trailing newline', async () => {
    const stream = createStream(['data: final']);
    const results: string[] = [];
    for await (const data of readSseData(stream)) {
      results.push(data);
    }
    expect(results).toEqual(['final']);
  });

  it('handles empty stream', async () => {
    const stream = createStream([]);
    const results: string[] = [];
    for await (const data of readSseData(stream)) {
      results.push(data);
    }
    expect(results).toEqual([]);
  });

  it('cancels reader on break from loop', async () => {
    const stream = createStream(['data: first\n\n', 'data: second\n\n']);
    const results: string[] = [];
    for await (const data of readSseData(stream)) {
      results.push(data);
      break;
    }
    expect(results).toEqual(['first']);
  });
});

// =============================================================================
// runProviderHealthCheck
// =============================================================================

describe('runProviderHealthCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeTarget(
    overrides: Partial<ProviderHealthCheckTarget> = {}
  ): ProviderHealthCheckTarget {
    return {
      providerId: 'test-provider',
      ready: true,
      notConfiguredError: 'API key not set',
      request: vi.fn().mockResolvedValue(new Response(null, { status: 200, statusText: 'OK' })),
      ...overrides,
    };
  }

  it('returns ok when provider is ready and request succeeds', async () => {
    const target = makeTarget();
    const resultPromise = runProviderHealthCheck(target);

    // Fast-forward past the timeout
    vi.advanceTimersByTime(100);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ok');
      expect(result.value.providerId).toBe('test-provider');
      expect(result.value.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns unavailable when provider is not ready', async () => {
    const target = makeTarget({ ready: false, notConfiguredError: 'No API key' });
    const result = await runProviderHealthCheck(target);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('unavailable');
      expect(result.value.error).toBe('No API key');
    }
  });

  it('returns unavailable when request throws', async () => {
    const target = makeTarget({
      request: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    const resultPromise = runProviderHealthCheck(target);

    vi.advanceTimersByTime(100);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('unavailable');
      expect(result.value.error).toBe('Network error');
    }
  });

  it('handles non-Error throw values', async () => {
    const target = makeTarget({
      request: vi.fn().mockRejectedValue('string error'),
    });
    const resultPromise = runProviderHealthCheck(target);

    vi.advanceTimersByTime(100);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('unavailable');
      expect(result.value.error).toBe('string error');
    }
  });

  it('returns unavailable on HTTP error status', async () => {
    const target = makeTarget({
      request: vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 500, statusText: 'Internal Server Error' })
        ),
    });
    const resultPromise = runProviderHealthCheck(target);

    vi.advanceTimersByTime(100);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('unavailable');
      expect(result.value.error).toContain('HTTP 500');
    }
  });

  it('treats HTTP 401 as ok when authErrorIsOk is true', async () => {
    const target = makeTarget({
      authErrorIsOk: true,
      request: vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 401, statusText: 'Unauthorized' })),
    });
    const resultPromise = runProviderHealthCheck(target);

    vi.advanceTimersByTime(100);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ok');
      expect(result.value.error).toBeUndefined();
    }
  });

  it('aborts request after 5s timeout', async () => {
    const abortSpy = vi.fn();
    const target = makeTarget({
      request: vi.fn(
        (signal: AbortSignal) =>
          new Promise<Response>((_, reject) => {
            signal.addEventListener('abort', () => {
              abortSpy();
              reject(new DOMException('Aborted', 'AbortError'));
            });
          })
      ),
    });
    const resultPromise = runProviderHealthCheck(target);

    // Advance beyond 5s
    vi.advanceTimersByTime(5001);
    const result = await resultPromise;

    expect(abortSpy).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('unavailable');
    }
  });
});
