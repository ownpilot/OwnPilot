/**
 * Tests for Telegram Webhook Handler (singleton module)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerWebhookHandler,
  unregisterWebhookHandler,
  getWebhookHandler,
} from './webhook.js';

// Mock grammy's webhookCallback
vi.mock('grammy', () => ({
  webhookCallback: vi.fn((_bot: unknown, _adapter: string) => {
    return async (req: Request) => new Response(`ok:${req.url}`, { status: 200 });
  }),
}));

describe('Telegram Webhook Handler', () => {
  beforeEach(() => {
    unregisterWebhookHandler();
  });

  // ==========================================================================
  // getWebhookHandler
  // ==========================================================================

  describe('getWebhookHandler()', () => {
    it('should return null when no handler is registered', () => {
      expect(getWebhookHandler()).toBeNull();
    });

    it('should return handler after registration', () => {
      const mockBot = { api: {} } as never;
      registerWebhookHandler(mockBot, 'test-secret');

      const handler = getWebhookHandler();
      expect(handler).not.toBeNull();
      expect(handler!.secret).toBe('test-secret');
      expect(typeof handler!.callback).toBe('function');
    });
  });

  // ==========================================================================
  // registerWebhookHandler
  // ==========================================================================

  describe('registerWebhookHandler()', () => {
    it('should create a handler with the provided secret', () => {
      const mockBot = { api: {} } as never;
      registerWebhookHandler(mockBot, 'my-secret-123');

      const handler = getWebhookHandler();
      expect(handler!.secret).toBe('my-secret-123');
    });

    it('should overwrite existing handler on re-registration', () => {
      const mockBot1 = { api: {} } as never;
      const mockBot2 = { api: {} } as never;

      registerWebhookHandler(mockBot1, 'secret-1');
      registerWebhookHandler(mockBot2, 'secret-2');

      const handler = getWebhookHandler();
      expect(handler!.secret).toBe('secret-2');
    });

    it('should create a callable callback', async () => {
      const mockBot = { api: {} } as never;
      registerWebhookHandler(mockBot, 'test-secret');

      const handler = getWebhookHandler();
      const req = new Request('https://example.com/webhooks/telegram/test-secret', {
        method: 'POST',
        body: '{}',
      });
      const response = await handler!.callback(req);
      expect(response.status).toBe(200);
    });
  });

  // ==========================================================================
  // unregisterWebhookHandler
  // ==========================================================================

  describe('unregisterWebhookHandler()', () => {
    it('should clear the registered handler', () => {
      const mockBot = { api: {} } as never;
      registerWebhookHandler(mockBot, 'test-secret');
      expect(getWebhookHandler()).not.toBeNull();

      unregisterWebhookHandler();
      expect(getWebhookHandler()).toBeNull();
    });

    it('should be safe to call when no handler exists', () => {
      expect(() => unregisterWebhookHandler()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      const mockBot = { api: {} } as never;
      registerWebhookHandler(mockBot, 'test-secret');

      unregisterWebhookHandler();
      unregisterWebhookHandler();
      expect(getWebhookHandler()).toBeNull();
    });
  });
});
