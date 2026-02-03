/**
 * MemoryServiceImpl Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryServiceImpl } from './memory-service-impl.js';
import type { Memory } from '../db/repositories/memories.js';

// Mock the gateway MemoryService
const mockMemoryService = {
  createMemory: vi.fn(),
  rememberMemory: vi.fn(),
  batchRemember: vi.fn(),
  getMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  listMemories: vi.fn(),
  searchMemories: vi.fn(),
  getImportantMemories: vi.fn(),
  getRecentMemories: vi.fn(),
  getStats: vi.fn(),
  boostMemory: vi.fn(),
  decayMemories: vi.fn(),
  cleanupMemories: vi.fn(),
  countMemories: vi.fn(),
};

vi.mock('./memory-service.js', () => ({
  getMemoryService: () => mockMemoryService,
}));

function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    userId: 'user-1',
    type: 'fact',
    content: 'The sky is blue',
    importance: 0.8,
    tags: ['nature'],
    accessedCount: 0,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    metadata: {},
    ...overrides,
  };
}

describe('MemoryServiceImpl', () => {
  let service: MemoryServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MemoryServiceImpl();
  });

  describe('createMemory', () => {
    it('creates and maps memory entry', async () => {
      const mock = createMockMemory();
      mockMemoryService.createMemory.mockResolvedValue(mock);

      const result = await service.createMemory('user-1', {
        type: 'fact',
        content: 'The sky is blue',
      });

      expect(mockMemoryService.createMemory).toHaveBeenCalledWith('user-1', {
        type: 'fact',
        content: 'The sky is blue',
      });
      expect(result.id).toBe('mem-1');
      expect(result.userId).toBe('user-1');
      expect(result.type).toBe('fact');
      expect(result.content).toBe('The sky is blue');
      expect(result.accessCount).toBe(0);
    });
  });

  describe('rememberMemory', () => {
    it('returns memory with deduplicated flag', async () => {
      const mock = createMockMemory();
      mockMemoryService.rememberMemory.mockResolvedValue({
        memory: mock,
        deduplicated: false,
      });

      const result = await service.rememberMemory('user-1', {
        type: 'fact',
        content: 'New fact',
      });

      expect(result.deduplicated).toBe(false);
      expect(result.memory.id).toBe('mem-1');
    });

    it('handles deduplicated memory', async () => {
      const mock = createMockMemory();
      mockMemoryService.rememberMemory.mockResolvedValue({
        memory: mock,
        deduplicated: true,
      });

      const result = await service.rememberMemory('user-1', {
        type: 'fact',
        content: 'Existing fact',
      });

      expect(result.deduplicated).toBe(true);
    });
  });

  describe('batchRemember', () => {
    it('batch creates with dedup stats', async () => {
      const m1 = createMockMemory({ id: 'mem-1' });
      const m2 = createMockMemory({ id: 'mem-2' });
      mockMemoryService.batchRemember.mockResolvedValue({
        created: 1,
        deduplicated: 1,
        memories: [m1, m2],
      });

      const result = await service.batchRemember('user-1', [
        { type: 'fact', content: 'Fact 1' },
        { type: 'fact', content: 'Fact 2' },
      ]);

      expect(result.created).toBe(1);
      expect(result.deduplicated).toBe(1);
      expect(result.memories).toHaveLength(2);
    });
  });

  describe('getMemory', () => {
    it('returns mapped memory entry', async () => {
      const mock = createMockMemory({ accessedCount: 5, accessedAt: new Date('2024-06-01') });
      mockMemoryService.getMemory.mockResolvedValue(mock);

      const result = await service.getMemory('user-1', 'mem-1');

      expect(result).not.toBeNull();
      expect(result!.accessCount).toBe(5);
      expect(result!.lastAccessedAt).toEqual(new Date('2024-06-01'));
    });

    it('returns null for not found', async () => {
      mockMemoryService.getMemory.mockResolvedValue(null);

      const result = await service.getMemory('user-1', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('updateMemory', () => {
    it('updates and returns mapped entry', async () => {
      const mock = createMockMemory({ content: 'Updated content', importance: 0.9 });
      mockMemoryService.updateMemory.mockResolvedValue(mock);

      const result = await service.updateMemory('user-1', 'mem-1', {
        content: 'Updated content',
        importance: 0.9,
      });

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Updated content');
      expect(result!.importance).toBe(0.9);
    });

    it('returns null for not found', async () => {
      mockMemoryService.updateMemory.mockResolvedValue(null);

      const result = await service.updateMemory('user-1', 'nonexistent', { content: 'x' });
      expect(result).toBeNull();
    });
  });

  describe('deleteMemory', () => {
    it('returns true on success', async () => {
      mockMemoryService.deleteMemory.mockResolvedValue(true);
      expect(await service.deleteMemory('user-1', 'mem-1')).toBe(true);
    });

    it('returns false for not found', async () => {
      mockMemoryService.deleteMemory.mockResolvedValue(false);
      expect(await service.deleteMemory('user-1', 'nonexistent')).toBe(false);
    });
  });

  describe('listMemories', () => {
    it('returns mapped list', async () => {
      mockMemoryService.listMemories.mockResolvedValue([
        createMockMemory({ id: 'mem-1' }),
        createMockMemory({ id: 'mem-2' }),
      ]);

      const result = await service.listMemories('user-1');
      expect(result).toHaveLength(2);
    });
  });

  describe('searchMemories', () => {
    it('searches with query and options', async () => {
      mockMemoryService.searchMemories.mockResolvedValue([createMockMemory()]);

      const result = await service.searchMemories('user-1', 'sky', { type: 'fact', limit: 10 });

      expect(mockMemoryService.searchMemories).toHaveBeenCalledWith('user-1', 'sky', {
        type: 'fact',
        limit: 10,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('getImportantMemories', () => {
    it('passes threshold and limit', async () => {
      mockMemoryService.getImportantMemories.mockResolvedValue([createMockMemory()]);

      const result = await service.getImportantMemories('user-1', {
        threshold: 0.7,
        limit: 5,
      });

      expect(mockMemoryService.getImportantMemories).toHaveBeenCalledWith('user-1', 0.7, 5);
      expect(result).toHaveLength(1);
    });
  });

  describe('getRecentMemories', () => {
    it('returns recent memories', async () => {
      mockMemoryService.getRecentMemories.mockResolvedValue([createMockMemory()]);

      const result = await service.getRecentMemories('user-1', 5);

      expect(mockMemoryService.getRecentMemories).toHaveBeenCalledWith('user-1', 5);
      expect(result).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    it('returns memory statistics', async () => {
      const stats = {
        total: 10,
        byType: { fact: 5, preference: 3, event: 2, skill: 0, conversation: 0 },
        avgImportance: 0.75,
        recentCount: 3,
      };
      mockMemoryService.getStats.mockResolvedValue(stats);

      const result = await service.getStats('user-1');
      expect(result.total).toBe(10);
      expect(result.byType.fact).toBe(5);
      expect(result.avgImportance).toBe(0.75);
    });
  });

  describe('boostMemory', () => {
    it('boosts and returns updated memory', async () => {
      const mock = createMockMemory({ importance: 0.95 });
      mockMemoryService.boostMemory.mockResolvedValue(mock);

      const result = await service.boostMemory('user-1', 'mem-1', 0.15);

      expect(mockMemoryService.boostMemory).toHaveBeenCalledWith('user-1', 'mem-1', 0.15);
      expect(result!.importance).toBe(0.95);
    });

    it('returns null for not found', async () => {
      mockMemoryService.boostMemory.mockResolvedValue(null);
      expect(await service.boostMemory('user-1', 'nonexistent')).toBeNull();
    });
  });

  describe('decayMemories', () => {
    it('returns count of decayed memories', async () => {
      mockMemoryService.decayMemories.mockResolvedValue(5);

      const result = await service.decayMemories('user-1', {
        daysThreshold: 30,
        decayFactor: 0.1,
      });

      expect(result).toBe(5);
    });
  });

  describe('cleanupMemories', () => {
    it('returns count of cleaned up memories', async () => {
      mockMemoryService.cleanupMemories.mockResolvedValue(3);

      const result = await service.cleanupMemories('user-1', {
        maxAge: 90,
        minImportance: 0.1,
      });

      expect(result).toBe(3);
    });
  });

  describe('countMemories', () => {
    it('returns total count', async () => {
      mockMemoryService.countMemories.mockResolvedValue(42);

      const result = await service.countMemories('user-1');
      expect(result).toBe(42);
    });
  });

  describe('type mapping', () => {
    it('maps accessedCount to accessCount', async () => {
      mockMemoryService.createMemory.mockResolvedValue(
        createMockMemory({ accessedCount: 7 }),
      );

      const result = await service.createMemory('user-1', {
        type: 'fact',
        content: 'test',
      });

      expect(result.accessCount).toBe(7);
    });

    it('maps accessedAt to lastAccessedAt', async () => {
      const date = new Date('2024-06-15');
      mockMemoryService.createMemory.mockResolvedValue(
        createMockMemory({ accessedAt: date }),
      );

      const result = await service.createMemory('user-1', {
        type: 'fact',
        content: 'test',
      });

      expect(result.lastAccessedAt).toEqual(date);
    });

    it('handles undefined source fields', async () => {
      mockMemoryService.createMemory.mockResolvedValue(
        createMockMemory({ source: undefined, sourceId: undefined, accessedAt: undefined }),
      );

      const result = await service.createMemory('user-1', {
        type: 'fact',
        content: 'test',
      });

      expect(result.source).toBeUndefined();
      expect(result.sourceId).toBeUndefined();
      expect(result.lastAccessedAt).toBeUndefined();
    });
  });
});
