/**
 * Webhook Routes Tests
 *
 * Comprehensive integration tests for all three webhook endpoints:
 *   POST /webhooks/telegram/:secret
 *   POST /webhooks/slack/events
 *   POST /webhooks/trigger/:triggerId
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// vi.hoisted() mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const {
  mockGetWebhookHandler,
  mockGetSlackWebhookHandler,
  mockTriggersRepo,
  MockTriggersRepository,
  mockGetServiceRegistry,
  mockLog,
} = vi.hoisted(() => {
  const mockLog = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };

  const mockTriggersRepo = {
    getByIdGlobal: vi.fn(),
  };

  // Class mock must use function keyword so it works with `new`
  const MockTriggersRepository = vi.fn(function () {
    return mockTriggersRepo;
  });

  const mockGetWebhookHandler = vi.fn();
  const mockGetSlackWebhookHandler = vi.fn();

  const mockWorkflowService = { executeWorkflow: vi.fn(async () => {}) };
  const mockGetServiceRegistry = vi.fn(() => ({
    get: vi.fn(() => mockWorkflowService),
  }));

  return {
    mockGetWebhookHandler,
    mockGetSlackWebhookHandler,
    mockTriggersRepo,
    MockTriggersRepository,
    mockGetServiceRegistry,
    mockLog,
  };
});

// ---------------------------------------------------------------------------
// vi.mock() calls
// ---------------------------------------------------------------------------

vi.mock('../channels/plugins/telegram/webhook.js', () => ({
  getWebhookHandler: mockGetWebhookHandler,
}));

vi.mock('../channels/plugins/slack/slack-api.js', () => ({
  getSlackWebhookHandler: mockGetSlackWebhookHandler,
}));

vi.mock('../db/repositories/triggers.js', () => ({
  TriggersRepository: MockTriggersRepository,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getServiceRegistry: mockGetServiceRegistry,
  };
});

vi.mock('../services/log.js', () => ({
  getLog: vi.fn(() => mockLog),
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

const { webhookRoutes } = await import('./webhooks.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLACK_SIGNING_SECRET = 'slack-signing-secret';

function computeSlackSignature(body: string, timestamp: string, secret: string): string {
  const sigBaseString = `v0:${timestamp}:${body}`;
  return 'v0=' + createHmac('sha256', secret).update(sigBaseString).digest('hex');
}

function computeWebhookSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// App setup — NO userId middleware (webhooks live outside auth)
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/webhooks', webhookRoutes);
  app.onError(errorHandler);
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
    it('returns 503 when handler not configured (getWebhookHandler returns null)', async () => {
      mockGetWebhookHandler.mockReturnValue(null);

      const res = await app.request('/webhooks/telegram/any-secret', {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('returns 403 when secret does not match', async () => {
      mockGetWebhookHandler.mockReturnValue({
        secret: 'correct-secret',
        callback: vi.fn(async () => new Response('OK')),
      });

      const res = await app.request('/webhooks/telegram/wrong-secret', {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ACCESS_DENIED');
    });

    it('returns 200 when secret matches and callback succeeds', async () => {
      const callback = vi.fn(async () => new Response('OK', { status: 200 }));
      mockGetWebhookHandler.mockReturnValue({
        secret: 'test-secret',
        callback,
      });

      const res = await app.request('/webhooks/telegram/test-secret', {
        method: 'POST',
        body: '{"update_id":1}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      expect(callback).toHaveBeenCalledTimes(1);
      // Callback must receive the raw Request object
      expect(callback.mock.calls[0]![0]).toBeInstanceOf(Request);
    });

    it('returns 500 when callback throws an error', async () => {
      mockGetWebhookHandler.mockReturnValue({
        secret: 'test-secret',
        callback: vi.fn(async () => {
          throw new Error('Grammy processing failed');
        }),
      });

      const res = await app.request('/webhooks/telegram/test-secret', {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 403 when secrets have different lengths (timing-safe)', async () => {
      mockGetWebhookHandler.mockReturnValue({
        secret: 'short',
        callback: vi.fn(async () => new Response('OK')),
      });

      const res = await app.request('/webhooks/telegram/a-much-longer-secret-value', {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(403);
    });
  });

  // ==========================================================================
  // POST /webhooks/slack/events
  // ==========================================================================

  describe('POST /webhooks/slack/events', () => {
    it('returns 200 with challenge for url_verification type (no handler needed)', async () => {
      mockGetSlackWebhookHandler.mockReturnValue(null);

      const body = { type: 'url_verification', challenge: 'abc123' };
      const res = await app.request('/webhooks/slack/events', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.challenge).toBe('abc123');
    });

    it('returns 503 when handler not configured and event is not url_verification', async () => {
      mockGetSlackWebhookHandler.mockReturnValue(null);

      const body = { type: 'event_callback', event: { type: 'message' } };
      const res = await app.request('/webhooks/slack/events', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('returns 200 OK when valid event processed successfully (no signature headers)', async () => {
      const callback = vi.fn(async () => {});
      mockGetSlackWebhookHandler.mockReturnValue({
        signingSecret: SLACK_SIGNING_SECRET,
        callback,
      });

      const body = { type: 'event_callback', event: { type: 'message' } };
      const res = await app.request('/webhooks/slack/events', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('OK');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when signature is invalid (after handler is configured)', async () => {
      const callback = vi.fn(async () => {});
      mockGetSlackWebhookHandler.mockReturnValue({
        signingSecret: SLACK_SIGNING_SECRET,
        callback,
      });

      const body = { type: 'event_callback', event: { type: 'message' } };
      const res = await app.request('/webhooks/slack/events', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          'x-slack-request-timestamp': '1234567890',
          'x-slack-signature': 'v0=invalidsignature',
        },
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ACCESS_DENIED');
      expect(callback).not.toHaveBeenCalled();
    });

    it('returns 200 OK when signature is valid', async () => {
      const callback = vi.fn(async () => {});
      mockGetSlackWebhookHandler.mockReturnValue({
        signingSecret: SLACK_SIGNING_SECRET,
        callback,
      });

      const body = { type: 'event_callback', event: { type: 'message' } };
      const rawBody = JSON.stringify(body);
      const timestamp = '1609459200';
      const signature = computeSlackSignature(rawBody, timestamp, SLACK_SIGNING_SECRET);

      const res = await app.request('/webhooks/slack/events', {
        method: 'POST',
        body: rawBody,
        headers: {
          'Content-Type': 'application/json',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature,
        },
      });

      expect(res.status).toBe(200);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('returns 200 OK when message event (type=message, no subtype) triggers callback', async () => {
      const callback = vi.fn(async () => {});
      mockGetSlackWebhookHandler.mockReturnValue({
        signingSecret: SLACK_SIGNING_SECRET,
        callback,
      });

      const event = { type: 'message', user: 'U123', text: 'hello', ts: '1234', channel: 'C1' };
      const body = { type: 'event_callback', event };

      const res = await app.request('/webhooks/slack/events', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(event);
    });

    it('returns 200 OK when message event has subtype — callback NOT called', async () => {
      const callback = vi.fn(async () => {});
      mockGetSlackWebhookHandler.mockReturnValue({
        signingSecret: SLACK_SIGNING_SECRET,
        callback,
      });

      const body = {
        type: 'event_callback',
        event: { type: 'message', subtype: 'bot_message', text: 'bot said hi' },
      };

      const res = await app.request('/webhooks/slack/events', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      // subtype present → skip callback
      expect(callback).not.toHaveBeenCalled();
    });

    it('returns 200 OK when non-message event type — callback NOT called', async () => {
      const callback = vi.fn(async () => {});
      mockGetSlackWebhookHandler.mockReturnValue({
        signingSecret: SLACK_SIGNING_SECRET,
        callback,
      });

      const body = { type: 'event_callback', event: { type: 'reaction_added' } };

      const res = await app.request('/webhooks/slack/events', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      expect(callback).not.toHaveBeenCalled();
    });

    it('returns 200 OK when body has no event property — callback NOT called', async () => {
      const callback = vi.fn(async () => {});
      mockGetSlackWebhookHandler.mockReturnValue({
        signingSecret: SLACK_SIGNING_SECRET,
        callback,
      });

      const body = { type: 'event_callback' };

      const res = await app.request('/webhooks/slack/events', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      expect(callback).not.toHaveBeenCalled();
    });

    it('returns 500 when callback throws an error', async () => {
      mockGetSlackWebhookHandler.mockReturnValue({
        signingSecret: SLACK_SIGNING_SECRET,
        callback: vi.fn(async () => {
          throw new Error('Slack processing error');
        }),
      });

      const body = { type: 'event_callback', event: { type: 'message' } };
      const res = await app.request('/webhooks/slack/events', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ==========================================================================
  // POST /webhooks/trigger/:triggerId
  // ==========================================================================

  describe('POST /webhooks/trigger/:triggerId', () => {
    function makeTrigger(overrides: Record<string, unknown> = {}) {
      return {
        id: 'trig-001',
        userId: 'user-abc',
        name: 'My Webhook Trigger',
        description: null,
        type: 'webhook',
        config: {},
        action: { type: 'chat', payload: {} },
        enabled: true,
        priority: 5,
        lastFired: null,
        nextFire: null,
        fireCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    it('returns 404 when trigger not found (getByIdGlobal returns null)', async () => {
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(null);

      const res = await app.request('/webhooks/trigger/nonexistent', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when trigger type is not webhook', async () => {
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(
        makeTrigger({ type: 'schedule', enabled: true })
      );

      const res = await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when trigger is not enabled', async () => {
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(
        makeTrigger({ type: 'webhook', enabled: false })
      );

      const res = await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 200 when trigger found and no secret configured', async () => {
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(
        makeTrigger({ config: {}, action: { type: 'chat', payload: {} } })
      );

      const res = await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: '{"data":"hello"}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.triggerId).toBe('trig-001');
    });

    it('returns 403 when secret configured but X-Webhook-Signature header missing', async () => {
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(
        makeTrigger({ config: { secret: 'webhook-secret' } })
      );

      const res = await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: '{"data":"hello"}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ACCESS_DENIED');
      expect(json.error.message).toContain('Missing X-Webhook-Signature');
    });

    it('returns 403 when signature is invalid', async () => {
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(
        makeTrigger({ config: { secret: 'webhook-secret' } })
      );

      const res = await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: '{"data":"hello"}',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': 'invalidsig',
        },
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ACCESS_DENIED');
      expect(json.error.message).toContain('Invalid webhook signature');
    });

    it('returns 200 when HMAC-SHA256 signature is valid', async () => {
      const secret = 'webhook-secret';
      const rawBody = '{"data":"hello"}';
      const signature = computeWebhookSignature(rawBody, secret);

      mockTriggersRepo.getByIdGlobal.mockResolvedValue(makeTrigger({ config: { secret } }));

      const res = await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: rawBody,
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': signature,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.triggerId).toBe('trig-001');
    });

    it('returns 200 and fires workflow when action type is workflow', async () => {
      const workflowId = 'wf-123';
      const trigger = makeTrigger({
        config: {},
        action: { type: 'workflow', payload: { workflowId } },
      });
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(trigger);

      const mockWorkflowService = { executeWorkflow: vi.fn(async () => {}) };
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => mockWorkflowService),
      });

      const res = await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Give the fire-and-forget promise a tick to execute
      await new Promise((r) => setTimeout(r, 0));
      expect(mockWorkflowService.executeWorkflow).toHaveBeenCalledWith(workflowId, 'user-abc');
    });

    it('returns 200 when trigger action type is not workflow (no executeWorkflow call)', async () => {
      const trigger = makeTrigger({
        config: {},
        action: { type: 'notification', payload: {} },
      });
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(trigger);

      const mockWorkflowService = { executeWorkflow: vi.fn(async () => {}) };
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => mockWorkflowService),
      });

      const res = await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 0));
      expect(mockWorkflowService.executeWorkflow).not.toHaveBeenCalled();
    });

    it('returns 200 when workflow action has no workflowId (no workflow fire)', async () => {
      const trigger = makeTrigger({
        config: {},
        action: { type: 'workflow', payload: {} }, // missing workflowId
      });
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(trigger);

      const mockWorkflowService = { executeWorkflow: vi.fn(async () => {}) };
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => mockWorkflowService),
      });

      const res = await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 0));
      expect(mockWorkflowService.executeWorkflow).not.toHaveBeenCalled();
    });

    it('returns 200 even when getServiceRegistry throws (workflow fire-and-forget errors silently)', async () => {
      const trigger = makeTrigger({
        config: {},
        action: { type: 'workflow', payload: { workflowId: 'wf-fail' } },
      });
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(trigger);
      mockGetServiceRegistry.mockImplementation(() => {
        throw new Error('Registry unavailable');
      });

      const res = await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      });

      // Route still returns 200 because service error is caught internally
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('includes triggerId in response data', async () => {
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(makeTrigger({ id: 'trig-xyz' }));

      const res = await app.request('/webhooks/trigger/trig-xyz', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.triggerId).toBe('trig-xyz');
      expect(json.data.message).toBe('Webhook received');
    });

    it('TriggersRepository instantiated without userId (global lookup)', async () => {
      mockTriggersRepo.getByIdGlobal.mockResolvedValue(null);

      await app.request('/webhooks/trigger/trig-001', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(MockTriggersRepository).toHaveBeenCalledTimes(1);
      expect(mockTriggersRepo.getByIdGlobal).toHaveBeenCalledWith('trig-001');
    });
  });
});
