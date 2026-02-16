/**
 * Memories Routes Tests
 *
 * Integration tests for the memories API endpoints.
 * Mocks the MemoryService to test route logic, query parsing, and response formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMemoryService = {
  listMemories: vi.fn(async () => []),
  countMemories: vi.fn(async () => 0),
  rememberMemory: vi.fn(),
  getMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  searchMemories: vi.fn(async () => []),
  hybridSearch: vi.fn(async () => []),
  boostMemory: vi.fn(),
  decayMemories: vi.fn(async () => 0),
  cleanupMemories: vi.fn(async () => 0),
  getStats: vi.fn(async () => ({
    total: 10,
    recentCount: 3,
    byType: { fact: 5, preference: 3, experience: 2 },
  })),
};

vi.mock('../services/memory-service.js', () => ({
  getMemoryService: () => mockMemoryService,
  MemoryServiceError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn((token: { name: string }) => {
        const services: Record<string, unknown> = { memory: mockMemoryService };
        return services[token.name];
      }),
    })),
  };
});

// Import after mocks
const { memoriesRoutes } = await import('./memories.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  // Simulate authenticated user
  app.use('*', async (c, next) => {
    c.set('userId', 'u1');
    await next();
  });
  app.route('/memories', memoriesRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Memories Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // GET /memories
  // ========================================================================

  describe('GET /memories', () => {
    it('returns memories with default params', async () => {
      mockMemoryService.listMemories.mockResolvedValue([
        { id: 'm1', content: 'Test memory', type: 'fact', importance: 0.8 },
      ]);
      mockMemoryService.countMemories.mockResolvedValue(1);

      const res = await app.request('/memories');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.memories).toHaveLength(1);
      expect(json.data.total).toBe(1);
    });

    it('passes query params to service', async () => {
      mockMemoryService.listMemories.mockResolvedValue([]);
      mockMemoryService.countMemories.mockResolvedValue(0);

      await app.request('/memories?type=fact&limit=5&minImportance=0.5');

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith('u1', {
        type: 'fact',
        limit: 5,
        minImportance: 0.5,
        orderBy: 'importance',
      });
      expect(mockMemoryService.countMemories).toHaveBeenCalledWith('u1', 'fact');
    });

    it('uses authenticated userId from context', async () => {
      mockMemoryService.listMemories.mockResolvedValue([]);
      mockMemoryService.countMemories.mockResolvedValue(0);

      await app.request('/memories');

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith('u1', expect.anything());
    });
  });

  // ========================================================================
  // POST /memories
  // ========================================================================

  describe('POST /memories', () => {
    it('creates a new memory', async () => {
      mockMemoryService.rememberMemory.mockResolvedValue({
        memory: { id: 'm1', content: 'User prefers dark mode', type: 'preference', importance: 0.6 },
        deduplicated: false,
      });

      const res = await app.request('/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'User prefers dark mode',
          type: 'preference',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.memory.id).toBe('m1');
      expect(json.data.message).toContain('created');
    });

    it('returns deduplicated response when similar memory exists', async () => {
      mockMemoryService.rememberMemory.mockResolvedValue({
        memory: { id: 'm1', content: 'Existing', type: 'fact', importance: 0.9 },
        deduplicated: true,
      });

      const res = await app.request('/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Similar', type: 'fact' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deduplicated).toBe(true);
    });
  });

  // ========================================================================
  // GET /memories/:id
  // ========================================================================

  describe('GET /memories/:id', () => {
    it('returns memory by id', async () => {
      mockMemoryService.getMemory.mockResolvedValue({
        id: 'm1',
        content: 'Test',
        type: 'fact',
      });

      const res = await app.request('/memories/m1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('m1');
    });

    it('returns 404 when memory not found', async () => {
      mockMemoryService.getMemory.mockResolvedValue(null);

      const res = await app.request('/memories/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // PATCH /memories/:id
  // ========================================================================

  describe('PATCH /memories/:id', () => {
    it('updates a memory', async () => {
      mockMemoryService.updateMemory.mockResolvedValue({
        id: 'm1',
        content: 'Updated content',
        importance: 0.9,
      });

      const res = await app.request('/memories/m1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importance: 0.9 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.importance).toBe(0.9);
    });

    it('returns 404 when memory not found', async () => {
      mockMemoryService.updateMemory.mockResolvedValue(null);

      const res = await app.request('/memories/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /memories/:id
  // ========================================================================

  describe('DELETE /memories/:id', () => {
    it('deletes a memory', async () => {
      mockMemoryService.deleteMemory.mockResolvedValue(true);

      const res = await app.request('/memories/m1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 404 when memory not found', async () => {
      mockMemoryService.deleteMemory.mockResolvedValue(false);

      const res = await app.request('/memories/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /memories/stats
  // ========================================================================

  describe('GET /memories/stats', () => {
    it('returns memory statistics', async () => {
      const res = await app.request('/memories/stats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(10);
      expect(json.data.byType).toBeDefined();
    });
  });

  // ========================================================================
  // GET /memories/search
  // ========================================================================

  describe('GET /memories/search', () => {
    it('searches memories by query (hybrid mode by default)', async () => {
      mockMemoryService.hybridSearch.mockResolvedValue([
        { id: 'm1', content: 'Matching memory', type: 'fact', importance: 0.9, score: 0.85, matchType: 'fts' },
      ]);

      const res = await app.request('/memories/search?q=matching');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.memories).toHaveLength(1);
      expect(json.data.count).toBe(1);
      expect(json.data.query).toBe('matching');
    });

    it('searches with keyword mode (fallback to text search)', async () => {
      mockMemoryService.searchMemories.mockResolvedValue([
        { id: 'm1', content: 'Matching memory', type: 'fact', importance: 0.9 },
      ]);

      const res = await app.request('/memories/search?q=matching&mode=keyword');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.mode).toBe('keyword');
    });

    it('returns 400 when query is missing', async () => {
      const res = await app.request('/memories/search');

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // POST /memories/:id/boost
  // ========================================================================

  describe('POST /memories/:id/boost', () => {
    it('boosts memory importance', async () => {
      mockMemoryService.boostMemory.mockResolvedValue({
        id: 'm1',
        importance: 0.95,
      });

      const res = await app.request('/memories/m1/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 0.1 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.memory.importance).toBe(0.95);
    });

    it('returns 404 when memory not found', async () => {
      mockMemoryService.boostMemory.mockResolvedValue(null);

      const res = await app.request('/memories/nonexistent/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 0.1 }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /memories/decay
  // ========================================================================

  describe('POST /memories/decay', () => {
    it('runs decay on old memories', async () => {
      mockMemoryService.decayMemories.mockResolvedValue(5);

      const res = await app.request('/memories/decay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysThreshold: 30, decayFactor: 0.1 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.affectedCount).toBe(5);
    });
  });

  // ========================================================================
  // POST /memories/cleanup
  // ========================================================================

  describe('POST /memories/cleanup', () => {
    it('cleans up low-importance memories', async () => {
      mockMemoryService.cleanupMemories.mockResolvedValue(3);

      const res = await app.request('/memories/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAge: 90, minImportance: 0.2 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deletedCount).toBe(3);
    });
  });
});
