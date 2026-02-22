/**
 * Workflow Copilot Route Tests
 *
 * Tests for the SSE streaming AI chat endpoint for workflow generation.
 * Validates request validation, provider resolution, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mock values (hoisted to avoid vi.mock factory temporal dead zone)
// ---------------------------------------------------------------------------

const { mockStream, mockComplete, mockLog } = vi.hoisted(() => ({
  mockStream: vi.fn(),
  mockComplete: vi.fn(),
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
let capturedStreamCallback:
  | ((stream: { writeSSE: ReturnType<typeof vi.fn> }) => Promise<void>)
  | null = null;

// ---------------------------------------------------------------------------
// vi.mock
// ---------------------------------------------------------------------------

vi.mock('../services/log.js', () => ({
  getLog: () => mockLog,
}));

vi.mock('./settings.js', () => ({
  resolveProviderAndModel: vi.fn(async () => ({ provider: 'openai', model: 'gpt-4o' })),
}));

vi.mock('./agent-cache.js', () => ({
  getProviderApiKey: vi.fn(async () => 'test-api-key'),
  loadProviderConfig: vi.fn(() => null),
  NATIVE_PROVIDERS: new Set(['openai', 'anthropic', 'google']),
}));

vi.mock('@ownpilot/core', () => ({
  createProvider: vi.fn(() => ({
    stream: mockStream,
    complete: mockComplete,
  })),
}));

vi.mock('./workflow-copilot-prompt.js', () => ({
  buildCopilotSystemPrompt: vi.fn(() => 'You are a Workflow Copilot.'),
}));

vi.mock('hono/streaming', () => ({
  streamSSE: vi.fn((_c: unknown, callback: (stream: unknown) => Promise<void>) => {
    capturedStreamCallback = callback as typeof capturedStreamCallback;
    return new Response('SSE stream', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }),
}));

// Import after mocks
const { workflowCopilotRoute } = await import('./workflow-copilot.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/copilot', workflowCopilotRoute);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Workflow Copilot Route', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedStreamCallback = null;
    app = createApp();
  });

  // ========================================================================
  // Input validation
  // ========================================================================

  describe('Input validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('BAD_REQUEST');
    });

    it('returns 400 when messages is missing', async () => {
      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when messages array is empty', async () => {
      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when message content is empty', async () => {
      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: '' }] }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid message role', async () => {
      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'system', content: 'test' }] }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // Provider resolution
  // ========================================================================

  describe('Provider resolution', () => {
    it('returns 400 when no provider is configured', async () => {
      const { resolveProviderAndModel } = await import('./settings.js');
      vi.mocked(resolveProviderAndModel).mockResolvedValueOnce({ provider: '', model: '' });

      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Create a workflow' }] }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('provider');
    });

    it('returns 400 when API key is not configured', async () => {
      const { getProviderApiKey } = await import('./agent-cache.js');
      vi.mocked(getProviderApiKey).mockResolvedValueOnce(undefined as unknown as string);

      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Create a workflow' }] }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('API key');
    });
  });

  // ========================================================================
  // Successful streaming
  // ========================================================================

  describe('Streaming', () => {
    it('returns SSE response for valid request', async () => {
      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Create a workflow' }] }),
      });

      expect(res.status).toBe(200);
      expect(capturedStreamCallback).toBeTruthy();
    });

    it('streams content chunks and done event', async () => {
      async function* fakeStream() {
        yield { ok: true, value: { content: 'Hello', done: false } };
        yield { ok: true, value: { content: ' world', done: false } };
        yield { ok: true, value: { content: '', done: true } };
      }
      mockStream.mockReturnValue(fakeStream());

      await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Create a workflow' }] }),
      });

      expect(capturedStreamCallback).toBeTruthy();
      const mockWriteSSE = vi.fn().mockResolvedValue(undefined);
      await capturedStreamCallback!({ writeSSE: mockWriteSSE });

      // Should have written delta chunks and done event
      const calls = mockWriteSSE.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);

      // First call: delta
      const firstData = JSON.parse(calls[0][0].data);
      expect(firstData.delta).toBe('Hello');

      // Second call: delta
      const secondData = JSON.parse(calls[1][0].data);
      expect(secondData.delta).toBe(' world');

      // Last call: done
      const lastData = JSON.parse(calls[calls.length - 1][0].data);
      expect(lastData.done).toBe(true);
      expect(lastData.content).toBe('Hello world');
    });

    it('handles stream error from provider', async () => {
      async function* fakeStream() {
        yield { ok: false, error: { message: 'Rate limit exceeded' } };
      }
      mockStream.mockReturnValue(fakeStream());

      await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Create a workflow' }] }),
      });

      const mockWriteSSE = vi.fn().mockResolvedValue(undefined);
      await capturedStreamCallback!({ writeSSE: mockWriteSSE });

      const errorData = JSON.parse(mockWriteSSE.mock.calls[0][0].data);
      expect(errorData.error).toBe('Rate limit exceeded');
    });

    it('handles stream exception', async () => {
      mockStream.mockImplementation(function* () {
        throw new Error('Connection lost');
      });

      await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Create a workflow' }] }),
      });

      const mockWriteSSE = vi.fn().mockResolvedValue(undefined);
      await capturedStreamCallback!({ writeSSE: mockWriteSSE });

      const errorData = JSON.parse(mockWriteSSE.mock.calls[0][0].data);
      expect(errorData.error).toContain('Connection lost');
    });
  });

  // ========================================================================
  // Optional fields
  // ========================================================================

  describe('Optional fields', () => {
    it('accepts currentWorkflow context', async () => {
      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Add a condition node' }],
          currentWorkflow: {
            name: 'My Workflow',
            nodes: [{ id: 'n1', type: 'toolNode', data: {} }],
            edges: [],
          },
        }),
      });

      expect(res.status).toBe(200);
    });

    it('accepts availableTools list', async () => {
      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Use the search tool' }],
          availableTools: ['core.search', 'core.add_memory'],
        }),
      });

      expect(res.status).toBe(200);
    });

    it('accepts custom provider and model', async () => {
      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Create a workflow' }],
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
        }),
      });

      expect(res.status).toBe(200);
    });

    it('passes multiple messages in conversation', async () => {
      const res = await app.request('/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'Create a workflow that sends emails' },
            { role: 'assistant', content: 'Here is a workflow...' },
            { role: 'user', content: 'Add error handling' },
          ],
        }),
      });

      expect(res.status).toBe(200);
    });
  });
});
