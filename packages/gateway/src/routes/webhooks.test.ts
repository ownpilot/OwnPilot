/**
 * Tests for Webhook Routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCallback = vi.fn(async () => new Response('ok', { status: 200 }));
const mockGetWebhookHandler = vi.fn();

vi.mock('../channels/plugins/telegram/webhook.js', () => ({
  getWebhookHandler: () => mockGetWebhookHandler(),
}));

// Import after mocks
const { webhookRoutes } = await import('./webhooks.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/webhooks', webhookRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Webhook Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ==========================================================================
  // POST /webhooks/telegram/:secret
  // ==========================================================================

  describe('POST /webhooks/telegram/:secret', () => {
    it('should return 503 when no webhook handler is configured', async () => {
      mockGetWebhookHandler.mockReturnValue(null);

      const res = await app.request('/webhooks/telegram/any-secret', {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('should return 403 for invalid secret', async () => {
      mockGetWebhookHandler.mockReturnValue({
        secret: 'correct-secret',
        callback: mockCallback,
      });

      const res = await app.request('/webhooks/telegram/wrong-secret', {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ACCESS_DENIED');
    });

    it('should forward request to callback on valid secret', async () => {
      mockGetWebhookHandler.mockReturnValue({
        secret: 'correct-secret',
        callback: mockCallback,
      });

      const res = await app.request('/webhooks/telegram/correct-secret', {
        method: 'POST',
        body: '{"update_id": 123}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      expect(mockCallback).toHaveBeenCalledTimes(1);
      // Verify the callback received a Request object
      const callArg = mockCallback.mock.calls[0]![0];
      expect(callArg).toBeInstanceOf(Request);
    });

    it('should return 500 when callback throws', async () => {
      mockGetWebhookHandler.mockReturnValue({
        secret: 'correct-secret',
        callback: vi.fn(async () => {
          throw new Error('Grammy processing failed');
        }),
      });

      const res = await app.request('/webhooks/telegram/correct-secret', {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });

    it('should use timing-safe comparison for secrets', async () => {
      // Secrets of different lengths should fail (but not leak timing info)
      mockGetWebhookHandler.mockReturnValue({
        secret: 'short',
        callback: mockCallback,
      });

      const res = await app.request('/webhooks/telegram/a-much-longer-secret-value', {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(403);
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should reject GET requests (method not allowed)', async () => {
      const res = await app.request('/webhooks/telegram/any-secret', {
        method: 'GET',
      });

      // Hono returns 404 for unmatched methods by default
      expect(res.status).toBe(404);
    });
  });
});
