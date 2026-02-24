/**
 * Memories Routes Tests
 *
 * Integration tests for the memories API endpoints.
 * Mocks the MemoryService to test route logic, query parsing, and response formatting.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';
import { createMockServiceRegistry } from '../test-helpers.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMemoryService = {
  listMemories: vi.fn(async () => []),
  countMemories: vi.fn(async () => 0),
  rememberMemory: vi.fn(),
  batchRemember: vi.fn(),
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
    getServiceRegistry: vi.fn(() => createMockServiceRegistry({ memory: mockMemoryService })),
  };
});

vi.mock('../ws/server.js', () => ({
  wsGateway: {
    broadcast: vi.fn(),
  },
}));

vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

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
        memory: {
          id: 'm1',
          content: 'User prefers dark mode',
          type: 'preference',
          importance: 0.6,
        },
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
        {
          id: 'm1',
          content: 'Matching memory',
          type: 'fact',
          importance: 0.9,
          score: 0.85,
          matchType: 'fts',
        },
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

    it('broadcasts data:changed when memories deleted', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockMemoryService.cleanupMemories.mockResolvedValue(5);

      await app.request('/memories/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'memory',
        action: 'deleted',
      });
    });

    it('does not broadcast when no memories cleaned up', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockMemoryService.cleanupMemories.mockResolvedValue(0);

      await app.request('/memories/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(wsGateway.broadcast).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // POST /memories - MemoryServiceError
  // ========================================================================

  describe('POST /memories - validation error', () => {
    it('returns 400 for MemoryServiceError with VALIDATION_ERROR code', async () => {
      const { MemoryServiceError } = await import('../services/memory-service.js');
      mockMemoryService.rememberMemory.mockRejectedValue(
        new MemoryServiceError('Content too short', 'VALIDATION_ERROR')
      );

      const res = await app.request('/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'X', type: 'fact' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Content too short');
    });

    it('re-throws non-MemoryServiceError exceptions', async () => {
      mockMemoryService.rememberMemory.mockRejectedValue(new Error('DB down'));

      const res = await app.request('/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Something', type: 'fact' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // PATCH /memories/:id - importance validation
  // ========================================================================

  describe('PATCH /memories/:id - importance validation', () => {
    it('returns 400 when importance is negative', async () => {
      const res = await app.request('/memories/m1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importance: -0.5 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('importance');
    });

    it('returns 400 when importance exceeds 1', async () => {
      const res = await app.request('/memories/m1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importance: 1.5 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('importance');
    });
  });

  // ========================================================================
  // POST /memories/:id/boost - validation
  // ========================================================================

  describe('POST /memories/:id/boost - validation', () => {
    it('uses default amount of 0.1 when not provided', async () => {
      mockMemoryService.boostMemory.mockResolvedValue({
        id: 'm1',
        importance: 0.9,
      });

      const res = await app.request('/memories/m1/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(mockMemoryService.boostMemory).toHaveBeenCalledWith('u1', 'm1', 0.1);
      const json = await res.json();
      expect(json.data.message).toContain('0.1');
    });

    it('returns 400 when amount exceeds 1', async () => {
      const res = await app.request('/memories/m1/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 2.0 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('amount');
    });

    it('returns 400 when amount is 0', async () => {
      const res = await app.request('/memories/m1/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 0 }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // POST /memories/decay - wsGateway broadcast
  // ========================================================================

  describe('POST /memories/decay - broadcast', () => {
    it('broadcasts data:changed when memories decayed', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockMemoryService.decayMemories.mockResolvedValue(3);

      await app.request('/memories/decay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'memory',
        action: 'updated',
      });
    });

    it('does not broadcast when zero memories decayed', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockMemoryService.decayMemories.mockResolvedValue(0);

      await app.request('/memories/decay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(wsGateway.broadcast).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // GET /memories - minImportance clamping
  // ========================================================================

  describe('GET /memories - minImportance', () => {
    it('clamps minImportance to [0, 1]', async () => {
      mockMemoryService.listMemories.mockResolvedValue([]);
      mockMemoryService.countMemories.mockResolvedValue(0);

      await app.request('/memories?minImportance=5.0');

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          minImportance: 1,
        })
      );
    });

    it('clamps negative minImportance to 0', async () => {
      mockMemoryService.listMemories.mockResolvedValue([]);
      mockMemoryService.countMemories.mockResolvedValue(0);

      await app.request('/memories?minImportance=-0.5');

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          minImportance: 0,
        })
      );
    });

    it('handles invalid minImportance string', async () => {
      mockMemoryService.listMemories.mockResolvedValue([]);
      mockMemoryService.countMemories.mockResolvedValue(0);

      await app.request('/memories?minImportance=abc');

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          minImportance: 0,
        })
      );
    });

    it('treats missing minImportance as undefined', async () => {
      mockMemoryService.listMemories.mockResolvedValue([]);
      mockMemoryService.countMemories.mockResolvedValue(0);

      await app.request('/memories');

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          minImportance: undefined,
        })
      );
    });
  });

  // ========================================================================
  // GET /memories/search - vector mode
  // ========================================================================

  describe('GET /memories/search - modes', () => {
    it('uses hybrid search for mode=vector', async () => {
      mockMemoryService.hybridSearch.mockResolvedValue([
        { id: 'm1', content: 'Match', type: 'fact' },
      ]);

      const res = await app.request('/memories/search?q=test&mode=vector');

      expect(res.status).toBe(200);
      expect(mockMemoryService.hybridSearch).toHaveBeenCalled();
      const json = await res.json();
      expect(json.data.mode).toBe('vector');
    });

    it('passes type filter to search', async () => {
      mockMemoryService.hybridSearch.mockResolvedValue([]);

      await app.request('/memories/search?q=test&type=preference&limit=5');

      expect(mockMemoryService.hybridSearch).toHaveBeenCalledWith('u1', 'test', {
        type: 'preference',
        limit: 5,
      });
    });
  });

  // ========================================================================
  // POST /memories/backfill-embeddings
  // ========================================================================

  // Note: backfill-embeddings uses dynamic import which is hard to mock
  // in this test setup. The route is tested indirectly through integration tests.

  // ========================================================================
  // DELETE /memories/:id - logging
  // ========================================================================

  describe('DELETE /memories/:id - ws broadcast', () => {
    it('broadcasts data:changed on successful delete', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockMemoryService.deleteMemory.mockResolvedValue(true);

      await app.request('/memories/m1', { method: 'DELETE' });

      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'memory',
        action: 'deleted',
        id: 'm1',
      });
    });
  });

  // ========================================================================
  // PATCH /memories/:id - ws broadcast
  // ========================================================================

  describe('PATCH /memories/:id - ws broadcast', () => {
    it('broadcasts data:changed on successful update', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockMemoryService.updateMemory.mockResolvedValue({
        id: 'm1',
        content: 'Updated',
        importance: 0.7,
      });

      await app.request('/memories/m1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated' }),
      });

      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'memory',
        action: 'updated',
        id: 'm1',
      });
    });
  });
});

// ============================================================================
// executeMemoryTool Tests
// ============================================================================

describe('executeMemoryTool', () => {
  let executeMemoryTool: (
    toolName: string,
    args: Record<string, unknown>,
    userId: string
  ) => Promise<{ success: boolean; result?: unknown; error?: string }>;

  beforeAll(async () => {
    const mod = await import('./memories.js');
    executeMemoryTool = mod.executeMemoryTool;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── create_memory ──────────────────────────────────────────

  describe('create_memory', () => {
    it('returns error when content missing', async () => {
      const result = await executeMemoryTool('create_memory', { type: 'fact' }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('content and type are required');
    });

    it('returns error when type missing', async () => {
      const result = await executeMemoryTool('create_memory', { content: 'Hello' }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('content and type are required');
    });

    it('creates memory successfully', async () => {
      mockMemoryService.rememberMemory.mockResolvedValue({
        memory: { id: 'm1', type: 'fact', importance: 0.5 },
        deduplicated: false,
      });

      const result = await executeMemoryTool(
        'create_memory',
        {
          content: 'User likes TypeScript',
          type: 'fact',
          importance: 0.7,
          tags: ['tech'],
        },
        'u1'
      );

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('Remembered');
      expect(result.result.memory.id).toBe('m1');
    });

    it('returns deduplicated message when similar memory exists', async () => {
      mockMemoryService.rememberMemory.mockResolvedValue({
        memory: { id: 'm1', type: 'fact', importance: 0.9 },
        deduplicated: true,
      });

      const result = await executeMemoryTool(
        'create_memory',
        {
          content: 'Similar content',
          type: 'fact',
        },
        'u1'
      );

      expect(result.success).toBe(true);
      expect(result.result.deduplicated).toBe(true);
      expect(result.result.message).toContain('already exists');
    });

    it('uses default importance of 0.5', async () => {
      mockMemoryService.rememberMemory.mockResolvedValue({
        memory: { id: 'm1', type: 'fact', importance: 0.5 },
        deduplicated: false,
      });

      await executeMemoryTool(
        'create_memory',
        {
          content: 'Some fact',
          type: 'fact',
        },
        'u1'
      );

      expect(mockMemoryService.rememberMemory).toHaveBeenCalledWith('u1', {
        content: 'Some fact',
        type: 'fact',
        importance: 0.5,
        tags: undefined,
      });
    });
  });

  // ─── batch_create_memories ──────────────────────────────────

  describe('batch_create_memories', () => {
    it('returns error when memories is not array', async () => {
      const result = await executeMemoryTool('batch_create_memories', {}, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('memories must be an array');
    });

    it('processes batch memories', async () => {
      mockMemoryService.batchRemember.mockResolvedValue({
        created: 2,
        deduplicated: 1,
        memories: [
          { id: 'm1', type: 'fact', importance: 0.5 },
          { id: 'm2', type: 'preference', importance: 0.7 },
          { id: 'm3', type: 'fact', importance: 0.8 },
        ],
      });

      const result = await executeMemoryTool(
        'batch_create_memories',
        {
          memories: [
            { content: 'Fact 1', type: 'fact' },
            { content: 'Pref 1', type: 'preference', importance: 0.7 },
            { content: 'Fact 2', type: 'fact', importance: 0.8 },
          ],
        },
        'u1'
      );

      expect(result.success).toBe(true);
      expect(result.result.created).toBe(2);
      expect(result.result.deduplicated).toBe(1);
      expect(result.result.memories).toHaveLength(3);
    });
  });

  // ─── search_memories ──────────────────────────────────────────

  describe('search_memories', () => {
    it('returns error when query missing', async () => {
      const result = await executeMemoryTool('search_memories', {}, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('query is required');
    });

    it('returns empty results message', async () => {
      mockMemoryService.hybridSearch.mockResolvedValue([]);

      const result = await executeMemoryTool(
        'search_memories',
        {
          query: 'nonexistent',
        },
        'u1'
      );

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('No memories found');
      expect(result.result.memories).toEqual([]);
    });

    it('returns found memories', async () => {
      mockMemoryService.hybridSearch.mockResolvedValue([
        {
          id: 'm1',
          type: 'fact',
          content: 'TypeScript is great',
          importance: 0.8,
          score: 0.95,
          matchType: 'fts',
          createdAt: '2026-01-01',
          tags: ['tech'],
        },
      ]);

      const result = await executeMemoryTool(
        'search_memories',
        {
          query: 'TypeScript',
        },
        'u1'
      );

      expect(result.success).toBe(true);
      expect(result.result.memories).toHaveLength(1);
      expect(result.result.memories[0].content).toBe('TypeScript is great');
    });

    it('filters by tags post-search', async () => {
      mockMemoryService.hybridSearch.mockResolvedValue([
        { id: 'm1', content: 'A', tags: ['tech', 'code'], importance: 0.8 },
        { id: 'm2', content: 'B', tags: ['personal'], importance: 0.7 },
      ]);

      const result = await executeMemoryTool(
        'search_memories',
        {
          query: 'test',
          tags: ['tech'],
        },
        'u1'
      );

      expect(result.success).toBe(true);
      expect(result.result.memories).toHaveLength(1);
      expect(result.result.memories[0].id).toBe('m1');
    });

    it('clamps limit to [1, 100]', async () => {
      mockMemoryService.hybridSearch.mockResolvedValue([]);

      await executeMemoryTool(
        'search_memories',
        {
          query: 'test',
          limit: 999,
        },
        'u1'
      );

      expect(mockMemoryService.hybridSearch).toHaveBeenCalledWith('u1', 'test', {
        type: undefined,
        limit: 100,
      });
    });
  });

  // ─── delete_memory ──────────────────────────────────────────

  describe('delete_memory', () => {
    it('returns error when memoryId missing', async () => {
      const result = await executeMemoryTool('delete_memory', {}, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('memoryId is required');
    });

    it('returns error when memory not found', async () => {
      mockMemoryService.getMemory.mockResolvedValue(null);

      const result = await executeMemoryTool('delete_memory', { memoryId: 'm999' }, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Memory not found');
    });

    it('deletes memory successfully', async () => {
      mockMemoryService.getMemory.mockResolvedValue({
        id: 'm1',
        content: 'Some old memory',
      });
      mockMemoryService.deleteMemory.mockResolvedValue(true);

      const result = await executeMemoryTool('delete_memory', { memoryId: 'm1' }, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('Forgot');
    });
  });

  // ─── list_memories ──────────────────────────────────────────

  describe('list_memories', () => {
    it('lists memories with defaults', async () => {
      mockMemoryService.listMemories.mockResolvedValue([
        {
          id: 'm1',
          type: 'fact',
          content: 'Test',
          importance: 0.5,
          tags: [],
          createdAt: '2026-01-01',
        },
      ]);
      mockMemoryService.countMemories.mockResolvedValue(1);

      const result = await executeMemoryTool('list_memories', {}, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.memories).toHaveLength(1);
      expect(result.result.total).toBe(1);
      expect(result.result.message).toContain('Found 1 memories');
    });

    it('filters by type', async () => {
      mockMemoryService.listMemories.mockResolvedValue([]);
      mockMemoryService.countMemories.mockResolvedValue(0);

      const result = await executeMemoryTool(
        'list_memories',
        {
          type: 'preference',
          limit: 5,
          minImportance: 0.3,
        },
        'u1'
      );

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith('u1', {
        type: 'preference',
        limit: 5,
        minImportance: 0.3,
        orderBy: 'importance',
      });
      expect(result.result.message).toContain('preference');
    });
  });

  // ─── update_memory_importance ──────────────────────────────

  describe('update_memory_importance', () => {
    it('returns error when memoryId missing', async () => {
      const result = await executeMemoryTool('update_memory_importance', {}, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('memoryId is required');
    });

    it('returns error when memory not found', async () => {
      mockMemoryService.boostMemory.mockResolvedValue(null);

      const result = await executeMemoryTool(
        'update_memory_importance',
        {
          memoryId: 'm999',
          amount: 0.2,
        },
        'u1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Memory not found');
    });

    it('boosts memory importance', async () => {
      mockMemoryService.boostMemory.mockResolvedValue({
        id: 'm1',
        content: 'Important fact',
        importance: 0.85,
      });

      const result = await executeMemoryTool(
        'update_memory_importance',
        {
          memoryId: 'm1',
          amount: 0.15,
        },
        'u1'
      );

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('0.85');
      expect(result.result.memory.importance).toBe(0.85);
    });

    it('uses default amount of 0.1', async () => {
      mockMemoryService.boostMemory.mockResolvedValue({
        id: 'm1',
        content: 'Fact',
        importance: 0.6,
      });

      await executeMemoryTool(
        'update_memory_importance',
        {
          memoryId: 'm1',
        },
        'u1'
      );

      expect(mockMemoryService.boostMemory).toHaveBeenCalledWith('u1', 'm1', 0.1);
    });
  });

  // ─── get_memory_stats ──────────────────────────────────────

  describe('get_memory_stats', () => {
    it('returns memory statistics', async () => {
      mockMemoryService.getStats.mockResolvedValue({
        total: 50,
        recentCount: 8,
      });

      const result = await executeMemoryTool('get_memory_stats', {}, 'u1');

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('50 total');
      expect(result.result.message).toContain('8 added this week');
      expect(result.result.stats.total).toBe(50);
    });
  });

  // ─── unknown tool ──────────────────────────────────────────

  describe('unknown tool', () => {
    it('returns error for unknown tool', async () => {
      const result = await executeMemoryTool('nonexistent_tool', {}, 'u1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });

  // ─── default userId ──────────────────────────────────────────

  describe('default userId', () => {
    it('uses "default" userId when not provided', async () => {
      mockMemoryService.listMemories.mockResolvedValue([]);
      mockMemoryService.countMemories.mockResolvedValue(0);

      await executeMemoryTool('list_memories', {});

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith('default', expect.anything());
    });
  });

  // ─── error handling ──────────────────────────────────────────

  describe('error handling', () => {
    it('catches MemoryServiceError and returns error message', async () => {
      const { MemoryServiceError } = await import('../services/memory-service.js');
      mockMemoryService.rememberMemory.mockRejectedValue(
        new MemoryServiceError('Duplicate memory', 'VALIDATION_ERROR')
      );

      const result = await executeMemoryTool(
        'create_memory',
        {
          content: 'Test',
          type: 'fact',
        },
        'u1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Duplicate memory');
    });

    it('catches generic errors and returns error message', async () => {
      mockMemoryService.rememberMemory.mockRejectedValue(new Error('DB connection failed'));

      const result = await executeMemoryTool(
        'create_memory',
        {
          content: 'Test',
          type: 'fact',
        },
        'u1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB connection failed');
    });
  });
});
