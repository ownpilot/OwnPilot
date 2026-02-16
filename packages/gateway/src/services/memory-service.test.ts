/**
 * MemoryService Tests
 *
 * Tests for business logic, validation, event emission,
 * deduplication, and delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryService, MemoryServiceError } from './memory-service.js';
import type { Memory } from '../db/repositories/memories.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEmit = vi.fn();
vi.mock('@ownpilot/core', () => ({
  getEventBus: () => ({ emit: mockEmit }),
  createEvent: vi.fn(
    (type: string, category: string, source: string, data: unknown) => ({
      type,
      category,
      source,
      data,
      timestamp: new Date().toISOString(),
    }),
  ),
  EventTypes: {
    RESOURCE_CREATED: 'resource.created',
    RESOURCE_UPDATED: 'resource.updated',
    RESOURCE_DELETED: 'resource.deleted',
  },
}));

const mockRepo = {
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  search: vi.fn(),
  findSimilar: vi.fn(),
  boost: vi.fn(),
  getImportant: vi.fn(),
  getRecent: vi.fn(),
  getFrequentlyAccessed: vi.fn(),
  getBySource: vi.fn(),
  getStats: vi.fn(),
  count: vi.fn(),
  decay: vi.fn(),
  cleanup: vi.fn(),
  hybridSearch: vi.fn(),
  searchByEmbedding: vi.fn(),
  getWithoutEmbeddings: vi.fn(),
  updateEmbedding: vi.fn(),
};

vi.mock('../db/repositories/memories.js', () => ({
  MemoriesRepository: vi.fn(),
  createMemoriesRepository: () => mockRepo,
}));

// Mock embedding queue (fire-and-forget, not tested here)
vi.mock('./embedding-queue.js', () => ({
  getEmbeddingQueue: () => ({
    enqueue: vi.fn(),
    backfill: vi.fn(),
    getStats: vi.fn(() => ({ queueSize: 0, running: false })),
  }),
}));

// Mock embedding service
const mockEmbeddingAvailable = vi.fn().mockReturnValue(false);
const mockGenerateEmbedding = vi.fn();

vi.mock('./embedding-service.js', () => ({
  getEmbeddingService: () => ({
    isAvailable: () => mockEmbeddingAvailable(),
    generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
  }),
}));

// Mock chunking (default: nothing should chunk in unit tests)
vi.mock('./chunking.js', () => ({
  shouldChunk: vi.fn().mockReturnValue(false),
  chunkMarkdown: vi.fn().mockReturnValue([]),
}));

// Mock log
vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    userId: 'user-1',
    type: 'fact',
    content: 'User likes TypeScript',
    importance: 0.5,
    tags: [],
    source: 'conversation',
    sourceId: null,
    accessCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryService', () => {
  let service: MemoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MemoryService();
  });

  // ========================================================================
  // createMemory
  // ========================================================================

  describe('createMemory', () => {
    it('creates a memory and emits resource.created', async () => {
      const memory = fakeMemory();
      mockRepo.create.mockResolvedValue(memory);

      const result = await service.createMemory('user-1', {
        type: 'fact',
        content: 'User likes TypeScript',
      });

      expect(result).toBe(memory);
      expect(mockRepo.create).toHaveBeenCalledWith({
        type: 'fact',
        content: 'User likes TypeScript',
      });
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.created',
          data: { resourceType: 'memory', id: 'mem-1' },
        }),
      );
    });

    it('throws VALIDATION_ERROR when content is empty', async () => {
      await expect(
        service.createMemory('user-1', { type: 'fact', content: '' }),
      ).rejects.toThrow(/Content is required/);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR when content is whitespace only', async () => {
      await expect(
        service.createMemory('user-1', { type: 'fact', content: '   ' }),
      ).rejects.toThrow(MemoryServiceError);
    });

    it('throws VALIDATION_ERROR when type is missing', async () => {
      await expect(
        service.createMemory('user-1', { type: undefined as unknown as string, content: 'x' }),
      ).rejects.toThrow(/Type is required/);
    });
  });

  // ========================================================================
  // rememberMemory (deduplication)
  // ========================================================================

  describe('rememberMemory', () => {
    it('creates new memory when no duplicate found', async () => {
      const memory = fakeMemory();
      mockRepo.findSimilar.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(memory);

      const result = await service.rememberMemory('user-1', {
        type: 'fact',
        content: 'New fact',
      });

      expect(result.deduplicated).toBe(false);
      expect(result.memory).toBe(memory);
      expect(mockRepo.create).toHaveBeenCalled();
    });

    it('boosts existing memory when duplicate found', async () => {
      const existing = fakeMemory({ importance: 0.5 });
      const boosted = fakeMemory({ importance: 0.6 });
      mockRepo.findSimilar.mockResolvedValue(existing);
      mockRepo.boost.mockResolvedValue(undefined);
      mockRepo.get.mockResolvedValue(boosted);

      const result = await service.rememberMemory('user-1', {
        type: 'fact',
        content: 'User likes TypeScript',
      });

      expect(result.deduplicated).toBe(true);
      expect(result.memory).toBe(boosted);
      expect(mockRepo.boost).toHaveBeenCalledWith('mem-1', 0.1);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('validates content before dedup check', async () => {
      await expect(
        service.rememberMemory('user-1', { type: 'fact', content: '' }),
      ).rejects.toThrow(/Content is required/);
      expect(mockRepo.findSimilar).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // batchRemember
  // ========================================================================

  describe('batchRemember', () => {
    it('processes multiple memories with deduplication', async () => {
      const mem1 = fakeMemory({ id: 'm1' });
      const mem2 = fakeMemory({ id: 'm2' });

      // First: new, Second: duplicate
      mockRepo.findSimilar.mockResolvedValueOnce(null).mockResolvedValueOnce(mem2);
      mockRepo.create.mockResolvedValue(mem1);
      mockRepo.boost.mockResolvedValue(undefined);
      mockRepo.get.mockResolvedValue(mem2);

      const result = await service.batchRemember('user-1', [
        { type: 'fact', content: 'New' },
        { type: 'fact', content: 'Existing' },
      ]);

      expect(result.created).toBe(1);
      expect(result.deduplicated).toBe(1);
      expect(result.memories).toHaveLength(2);
    });

    it('skips entries with empty content', async () => {
      mockRepo.findSimilar.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(fakeMemory());

      const result = await service.batchRemember('user-1', [
        { type: 'fact', content: 'Valid' },
        { type: 'fact', content: '' },
        { type: undefined as unknown as string, content: 'No type' },
      ]);

      expect(result.created).toBe(1);
      expect(result.memories).toHaveLength(1);
    });
  });

  // ========================================================================
  // updateMemory / deleteMemory
  // ========================================================================

  describe('updateMemory', () => {
    it('updates and emits resource.updated', async () => {
      const updated = fakeMemory({ content: 'Updated' });
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.updateMemory('user-1', 'mem-1', { content: 'Updated' });

      expect(result).toBe(updated);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.updated',
          data: expect.objectContaining({ resourceType: 'memory', id: 'mem-1' }),
        }),
      );
    });

    it('does not emit when memory not found', async () => {
      mockRepo.update.mockResolvedValue(null);
      const result = await service.updateMemory('user-1', 'missing', { content: 'x' });
      expect(result).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('deleteMemory', () => {
    it('deletes and emits resource.deleted', async () => {
      mockRepo.delete.mockResolvedValue(true);

      const result = await service.deleteMemory('user-1', 'mem-1');

      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.deleted',
          data: { resourceType: 'memory', id: 'mem-1' },
        }),
      );
    });

    it('does not emit when memory not found', async () => {
      mockRepo.delete.mockResolvedValue(false);
      const result = await service.deleteMemory('user-1', 'missing');
      expect(result).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Queries
  // ========================================================================

  describe('query methods', () => {
    it('searchMemories delegates to repo', async () => {
      mockRepo.search.mockResolvedValue([]);
      await service.searchMemories('user-1', 'typescript', { type: 'fact', limit: 5 });
      expect(mockRepo.search).toHaveBeenCalledWith('typescript', { type: 'fact', limit: 5 });
    });

    it('getImportantMemories delegates to repo', async () => {
      mockRepo.getImportant.mockResolvedValue([]);
      await service.getImportantMemories('user-1', 0.8, 10);
      expect(mockRepo.getImportant).toHaveBeenCalledWith(0.8, 10);
    });

    it('getRecentMemories delegates to repo', async () => {
      mockRepo.getRecent.mockResolvedValue([]);
      await service.getRecentMemories('user-1', 15);
      expect(mockRepo.getRecent).toHaveBeenCalledWith(15);
    });

    it('countMemories delegates to repo', async () => {
      mockRepo.count.mockResolvedValue(42);
      const result = await service.countMemories('user-1', 'fact');
      expect(result).toBe(42);
      expect(mockRepo.count).toHaveBeenCalledWith('fact');
    });
  });

  // ========================================================================
  // Hybrid Search
  // ========================================================================

  describe('hybridSearch', () => {
    it('delegates to repo.hybridSearch with embedding unavailable', async () => {
      mockEmbeddingAvailable.mockReturnValue(false);
      mockRepo.hybridSearch.mockResolvedValue([]);

      await service.hybridSearch('user-1', 'search query');

      expect(mockRepo.hybridSearch).toHaveBeenCalledWith('search query', {
        embedding: undefined,
        type: undefined,
        limit: undefined,
        minImportance: undefined,
      });
    });

    it('generates embedding when service is available', async () => {
      mockEmbeddingAvailable.mockReturnValue(true);
      mockGenerateEmbedding.mockResolvedValue({ embedding: [0.1, 0.2, 0.3], cached: false });
      mockRepo.hybridSearch.mockResolvedValue([]);

      await service.hybridSearch('user-1', 'search query');

      expect(mockGenerateEmbedding).toHaveBeenCalledWith('search query');
      expect(mockRepo.hybridSearch).toHaveBeenCalledWith('search query', {
        embedding: [0.1, 0.2, 0.3],
        type: undefined,
        limit: undefined,
        minImportance: undefined,
      });
    });

    it('falls back gracefully when embedding generation fails', async () => {
      mockEmbeddingAvailable.mockReturnValue(true);
      mockGenerateEmbedding.mockRejectedValue(new Error('API error'));
      mockRepo.hybridSearch.mockResolvedValue([]);

      await service.hybridSearch('user-1', 'search query');

      expect(mockRepo.hybridSearch).toHaveBeenCalledWith('search query', {
        embedding: undefined,
        type: undefined,
        limit: undefined,
        minImportance: undefined,
      });
    });

    it('passes type and limit options', async () => {
      mockEmbeddingAvailable.mockReturnValue(false);
      mockRepo.hybridSearch.mockResolvedValue([]);

      await service.hybridSearch('user-1', 'query', { type: 'fact', limit: 5, minImportance: 0.3 });

      expect(mockRepo.hybridSearch).toHaveBeenCalledWith('query', {
        embedding: undefined,
        type: 'fact',
        limit: 5,
        minImportance: 0.3,
      });
    });
  });

  describe('getWithoutEmbeddings', () => {
    it('delegates to repo', async () => {
      mockRepo.getWithoutEmbeddings.mockResolvedValue([]);
      await service.getWithoutEmbeddings('user-1', 50);
      expect(mockRepo.getWithoutEmbeddings).toHaveBeenCalledWith(50);
    });
  });

  // ========================================================================
  // Maintenance
  // ========================================================================

  describe('maintenance methods', () => {
    it('boostMemory delegates to repo', async () => {
      const boosted = fakeMemory({ importance: 0.7 });
      mockRepo.boost.mockResolvedValue(boosted);

      const result = await service.boostMemory('user-1', 'mem-1', 0.2);
      expect(result).toBe(boosted);
      expect(mockRepo.boost).toHaveBeenCalledWith('mem-1', 0.2);
    });

    it('decayMemories delegates to repo', async () => {
      mockRepo.decay.mockResolvedValue(5);
      const result = await service.decayMemories('user-1', { daysThreshold: 30 });
      expect(result).toBe(5);
    });

    it('cleanupMemories delegates to repo', async () => {
      mockRepo.cleanup.mockResolvedValue(3);
      const result = await service.cleanupMemories('user-1', { maxAge: 90 });
      expect(result).toBe(3);
    });
  });
});
