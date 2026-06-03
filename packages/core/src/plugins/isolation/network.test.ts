import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Resolve every hostname to a public IP so the SSRF guard lets the request
// through to the (mocked) fetch.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

const { PluginIsolatedNetwork } = await import('./network.js');
import type { PluginId } from '../../types/branded.js';

// ── A ReadableStream that records how many chunks were actually pulled, so we
// can prove the reader stops early instead of draining the whole body. ──

let chunksPulled = 0;

function countingBodyStream(totalChunks: number, chunkSize: number): ReadableStream<Uint8Array> {
  let emitted = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= totalChunks) {
        controller.close();
        return;
      }
      emitted++;
      chunksPulled++;
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });
}

function fakeResponse(
  body: ReadableStream<Uint8Array> | null,
  headers: Record<string, string> = {}
): Response {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status: 200,
    statusText: 'OK',
    headers: {
      get: (k: string) => h.get(k.toLowerCase()) ?? null,
      forEach: (cb: (v: string, k: string) => void) => h.forEach((v, k) => cb(v, k)),
    },
    body,
    // Faithfully drain the stream like a real Response.text(): this is what the
    // OLD (pre-fix) code path called, and it pulls EVERY chunk into memory —
    // exactly the unbounded-buffering behavior the fix removes.
    text: async () => {
      if (!body) return '';
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let s = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        s += decoder.decode(value, { stream: true });
      }
      return s + decoder.decode();
    },
  } as unknown as Response;
}

const MB = 1024 * 1024;

describe('PluginIsolatedNetwork response size cap', () => {
  beforeEach(() => {
    chunksPulled = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('aborts a no-content-length response once it exceeds maxResponseSize without draining it', async () => {
    // 20 MB of body offered in 1 MB chunks, with NO content-length header — the
    // exact case the old post-read check could not bound.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(countingBodyStream(20, MB)))
    );

    const net = new PluginIsolatedNetwork('test-plugin' as PluginId, ['*']);
    const result = await net.fetch('https://example.com/huge');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('response_too_large');
    }
    // The 10 MB cap means the reader should stop after ~11 of the 20 chunks and
    // cancel — never pulling the full body into memory. (Without streaming
    // enforcement, response.text() drains all 20.)
    expect(chunksPulled).toBeLessThan(20);
    expect(chunksPulled).toBeLessThanOrEqual(12);
  });

  it('returns a small streamed body intact', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(countingBodyStream(2, 16)))
    );

    const net = new PluginIsolatedNetwork('test-plugin' as PluginId, ['*']);
    const result = await net.fetch('https://example.com/small');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.body.length).toBe(32);
    }
  });
});
