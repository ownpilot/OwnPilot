import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signPayload, deliverWebhook, fireBlockingWebhooks, clearDedup, RETRY_CONFIG } from '../src/webhook-sender.ts';
import { webhookStore } from '../src/webhook-store.ts';
import type { PendingApproval } from '../src/types.ts';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Suppress pino logger output during webhook tests
vi.mock('../src/utils/logger.ts', () => {
  const silent = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => silent,
  };
  return { logger: silent };
});

// Save original retry config
const originalDelays = [...RETRY_CONFIG.delaysMs];

describe('webhook-sender', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    webhookStore.clear();
    clearDedup();
    // Zero delays for fast testing
    RETRY_CONFIG.delaysMs = [0, 0, 0];
  });

  afterEach(() => {
    RETRY_CONFIG.delaysMs = originalDelays;
  });

  describe('signPayload()', () => {
    it('should produce HMAC-SHA256 signature', () => {
      const sig = signPayload('{"test":true}', 'secret123');
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should produce deterministic output', () => {
      const sig1 = signPayload('hello', 'key');
      const sig2 = signPayload('hello', 'key');
      expect(sig1).toBe(sig2);
    });

    it('should differ with different secrets', () => {
      const sig1 = signPayload('hello', 'key1');
      const sig2 = signPayload('hello', 'key2');
      expect(sig1).not.toBe(sig2);
    });

    it('should differ with different payloads', () => {
      const sig1 = signPayload('hello', 'key');
      const sig2 = signPayload('world', 'key');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('deliverWebhook()', () => {
    const config = {
      id: 'wh-1',
      url: 'https://example.com/hook',
      secret: null,
      events: ['blocking'],
      createdAt: new Date().toISOString(),
    };

    const payload = {
      event: 'session.blocking',
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      pattern: 'QUESTION',
      text: 'Which DB?',
      timestamp: new Date().toISOString(),
      respondUrl: 'http://localhost:9090/v1/sessions/sess-1/respond',
    };

    it('should return true on successful delivery', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      const result = await deliverWebhook(config, payload);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should send correct headers without secret', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      await deliverWebhook(config, payload);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['Content-Type']).toBe('application/json');
      expect(callArgs[1].headers['User-Agent']).toBe('OpenClaw-Bridge/1.0');
      expect(callArgs[1].headers['X-Bridge-Event']).toBe('session.blocking');
      expect(callArgs[1].headers['X-Bridge-Signature']).toBeUndefined();
    });

    it('should include HMAC signature when secret is set', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      const configWithSecret = { ...config, secret: 'my-secret' };
      await deliverWebhook(configWithSecret, payload);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['X-Bridge-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should retry on non-2xx response', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
        .mockResolvedValueOnce({ ok: false, status: 502, statusText: 'Bad Gateway' })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await deliverWebhook(config, payload);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should retry on network error', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await deliverWebhook(config, payload);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return false after all retries fail', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' });

      const result = await deliverWebhook(config, payload);
      expect(result).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should send JSON body', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      await deliverWebhook(config, payload);
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.event).toBe('session.blocking');
      expect(body.conversationId).toBe('conv-1');
      expect(body.pattern).toBe('QUESTION');
    });
  });

  describe('fireBlockingWebhooks()', () => {
    const approval: PendingApproval = {
      pattern: 'QUESTION',
      text: 'Which framework?',
      detectedAt: Date.now(),
    };

    it('should not fire if no webhooks registered', () => {
      fireBlockingWebhooks('conv-1', 'sess-1', approval, 'http://localhost:9090');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fire for matching webhooks', async () => {
      webhookStore.register({ url: 'https://a.com/hook', events: ['blocking'] });
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      fireBlockingWebhooks('conv-1', 'sess-1', approval, 'http://localhost:9090');

      // Fire-and-forget: allow microtask queue to flush
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should fire multiple webhooks concurrently', async () => {
      webhookStore.register({ url: 'https://a.com/hook' });
      webhookStore.register({ url: 'https://b.com/hook' });
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      fireBlockingWebhooks('conv-1', 'sess-1', approval, 'http://localhost:9090');

      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate same webhook+session within window', async () => {
      webhookStore.register({ url: 'https://a.com/hook' });
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      fireBlockingWebhooks('conv-1', 'sess-1', approval, 'http://localhost:9090');
      fireBlockingWebhooks('conv-1', 'sess-1', approval, 'http://localhost:9090'); // duplicate

      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should include respondUrl in payload', async () => {
      webhookStore.register({ url: 'https://a.com/hook' });
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      fireBlockingWebhooks('conv-1', 'sess-1', approval, 'http://localhost:9090');

      await new Promise((r) => setTimeout(r, 50));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.respondUrl).toBe('http://localhost:9090/v1/sessions/sess-1/respond');
    });
  });
});
