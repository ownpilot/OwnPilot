/**
 * Extensions Eval Routes Tests
 *
 * Integration tests for:
 *   POST /:id/eval/run                 — run query with/without skill active
 *   POST /:id/eval/grade               — grade response with LLM
 *   POST /:id/eval/optimize-description — generate alternative descriptions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockComplete = vi.fn();

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createProvider: vi.fn(() => ({ complete: mockComplete })),
    getProviderConfig: vi.fn(() => null),
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn(() => mockExtService),
    })),
  };
});

const mockExtService = {
  getById: vi.fn(),
  getSystemPromptSectionsForIds: vi.fn(() => []),
};

const mockResolveProviderAndModel = vi.fn(async () => ({ provider: 'openai', model: 'gpt-4' }));
const mockGetApiKey = vi.fn(async () => 'test-api-key');

vi.mock('../settings.js', () => ({
  resolveProviderAndModel: (...args: unknown[]) =>
    mockResolveProviderAndModel(...(args as [string, string])),
  getApiKey: (...args: unknown[]) => mockGetApiKey(...(args as [string])),
}));

vi.mock('../../db/repositories/index.js', () => ({
  localProvidersRepo: {
    getProvider: vi.fn(async () => null),
  },
}));

const { evalRoutes } = await import('./eval.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', USER_ID);
    await next();
  });
  app.route('/ext', evalRoutes);
  app.onError(errorHandler);
  return app;
}

const makeExt = (overrides: Record<string, unknown> = {}) => ({
  id: 'ext-1',
  userId: USER_ID,
  name: 'My Skill',
  description: 'Does things',
  manifest: { format: 'agentskills' },
  version: '1.0.0',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Extensions Eval Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProviderAndModel.mockResolvedValue({ provider: 'openai', model: 'gpt-4' });
    mockGetApiKey.mockResolvedValue('test-api-key');
    mockExtService.getById.mockReturnValue(makeExt());
    mockExtService.getSystemPromptSectionsForIds.mockReturnValue([]);
    app = createApp();
  });

  // ========================================================================
  // POST /:id/eval/run
  // ========================================================================

  describe('POST /:id/eval/run', () => {
    it('runs query without skill active', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: 'Hello there!' },
      });

      const res = await app.request('/ext/ext-1/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Say hello', withSkill: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.response).toBe('Hello there!');
      expect(json.data.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockExtService.getSystemPromptSectionsForIds).not.toHaveBeenCalled();
    });

    it('runs query with skill active — injects system prompt sections', async () => {
      mockExtService.getSystemPromptSectionsForIds.mockReturnValue(['## My Skill\nUse this.']);
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: 'Skill-aware response' },
      });

      const res = await app.request('/ext/ext-1/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'What can you do?', withSkill: true }),
      });

      expect(res.status).toBe(200);
      expect(mockExtService.getSystemPromptSectionsForIds).toHaveBeenCalledWith(['ext-1']);

      // Verify system prompt was injected
      const callArgs = mockComplete.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain('## My Skill');
    });

    it('returns 404 when extension not found', async () => {
      mockExtService.getById.mockReturnValue(undefined);

      const res = await app.request('/ext/nonexistent/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'hello', withSkill: false }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when extension belongs to different user', async () => {
      mockExtService.getById.mockReturnValue(makeExt({ userId: 'other-user' }));

      const res = await app.request('/ext/ext-1/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'hello', withSkill: false }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when query is missing', async () => {
      const res = await app.request('/ext/ext-1/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withSkill: false }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 when no provider configured', async () => {
      mockResolveProviderAndModel.mockResolvedValueOnce({ provider: '', model: '' });

      const res = await app.request('/ext/ext-1/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'hello', withSkill: false }),
      });

      expect(res.status).toBe(500);
    });

    it('returns 500 when LLM call fails', async () => {
      mockComplete.mockResolvedValue({
        ok: false,
        error: { message: 'Rate limit' },
      });

      const res = await app.request('/ext/ext-1/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'hello', withSkill: false }),
      });

      expect(res.status).toBe(500);
    });

    it('returns 500 when provider.complete throws', async () => {
      mockComplete.mockRejectedValue(new Error('Network error'));

      const res = await app.request('/ext/ext-1/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'hello', withSkill: false }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /:id/eval/grade
  // ========================================================================

  describe('POST /:id/eval/grade', () => {
    it('grades a response and returns score/passed/feedback', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: '{"score": 0.85, "passed": true, "feedback": "Good response"}' },
      });

      const res = await app.request('/ext/ext-1/eval/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'How do I reset my password?',
          response: 'Click forgot password...',
          expectedKeywords: ['password', 'reset'],
          notes: '',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.score).toBe(0.85);
      expect(json.data.passed).toBe(true);
      expect(json.data.feedback).toBe('Good response');
    });

    it('extracts JSON from mixed text response', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: {
          content:
            'Here is my evaluation: {"score": 0.6, "passed": false, "feedback": "Missing keywords"}',
        },
      });

      const res = await app.request('/ext/ext-1/eval/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'test',
          response: 'response',
          expectedKeywords: [],
          notes: '',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.score).toBe(0.6);
      expect(json.data.passed).toBe(false);
    });

    it('falls back gracefully when LLM returns non-JSON text', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: 'The response looks decent overall.' },
      });

      const res = await app.request('/ext/ext-1/eval/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test', response: 'resp', expectedKeywords: [], notes: '' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.score).toBe(0.5); // fallback score
    });

    it('returns 400 when query is missing', async () => {
      const res = await app.request('/ext/ext-1/eval/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'some response' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when response is missing', async () => {
      const res = await app.request('/ext/ext-1/eval/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'some query' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when extension not found', async () => {
      mockExtService.getById.mockReturnValue(undefined);

      const res = await app.request('/ext/nonexistent/eval/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test', response: 'test' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 500 when grading LLM fails', async () => {
      mockComplete.mockResolvedValue({
        ok: false,
        error: { message: 'timeout' },
      });

      const res = await app.request('/ext/ext-1/eval/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test', response: 'resp', expectedKeywords: [], notes: '' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /:id/eval/optimize-description
  // ========================================================================

  describe('POST /:id/eval/optimize-description', () => {
    const makeOptimizeBody = (overrides = {}) => ({
      currentDescription: 'Helps with tasks',
      testQueries: ['How do I do X?', 'Help me with Y'],
      iterations: 2,
      ...overrides,
    });

    // Provide alternating: description generations + grade responses
    const setupIterations = (count: number) => {
      for (let i = 0; i < count; i++) {
        // Description generation
        mockComplete.mockResolvedValueOnce({
          ok: true,
          value: { content: `Improved description iteration ${i + 1}` },
        });
        // Grade responses (one per query)
        for (let q = 0; q < 2; q++) {
          mockComplete.mockResolvedValueOnce({
            ok: true,
            value: { content: q === 0 ? 'yes' : 'no' },
          });
        }
      }
    };

    it('returns iterations and best result', async () => {
      setupIterations(2);

      const res = await app.request('/ext/ext-1/eval/optimize-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeOptimizeBody()),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.iterations).toHaveLength(2);
      expect(json.data.best).toBeDefined();
      expect(json.data.best.description).toContain('Improved description');
    });

    it('best is the iteration with highest triggerAccuracy', async () => {
      // Iteration 1: 1/2 yes → accuracy 0.5
      mockComplete.mockResolvedValueOnce({ ok: true, value: { content: 'Desc A' } });
      mockComplete.mockResolvedValueOnce({ ok: true, value: { content: 'yes' } });
      mockComplete.mockResolvedValueOnce({ ok: true, value: { content: 'no' } });
      // Iteration 2: 2/2 yes → accuracy 1.0
      mockComplete.mockResolvedValueOnce({ ok: true, value: { content: 'Desc B' } });
      mockComplete.mockResolvedValueOnce({ ok: true, value: { content: 'yes' } });
      mockComplete.mockResolvedValueOnce({ ok: true, value: { content: 'yes' } });

      const res = await app.request('/ext/ext-1/eval/optimize-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeOptimizeBody({ iterations: 2 })),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.best.description).toBe('Desc B');
      expect(json.data.best.triggerAccuracy).toBe(1.0);
    });

    it('caps iterations at 5', async () => {
      setupIterations(5);

      const res = await app.request('/ext/ext-1/eval/optimize-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeOptimizeBody({ iterations: 99 })),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.iterations).toHaveLength(5);
    });

    it('returns 400 when testQueries is missing', async () => {
      const res = await app.request('/ext/ext-1/eval/optimize-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentDescription: 'desc' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when testQueries is empty', async () => {
      const res = await app.request('/ext/ext-1/eval/optimize-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentDescription: 'desc', testQueries: [] }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when extension not found', async () => {
      mockExtService.getById.mockReturnValue(undefined);

      const res = await app.request('/ext/ext-1/eval/optimize-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeOptimizeBody()),
      });

      expect(res.status).toBe(404);
    });

    it('returns 500 when no provider configured', async () => {
      mockResolveProviderAndModel.mockResolvedValueOnce({ provider: '', model: '' });

      const res = await app.request('/ext/ext-1/eval/optimize-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeOptimizeBody()),
      });

      expect(res.status).toBe(500);
    });
  });
});
