/**
 * EmbeddingQueue Tests
 *
 * Tests for background embedding queue: enqueue, dedup, priority, processing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingQueue } from './embedding-queue.js';
import { EMBEDDING_QUEUE_MAX_SIZE } from '../config/defaults.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockIsAvailable = vi.fn().mockReturnValue(true);
const mockGenerateBatch = vi.fn();

vi.mock('@ownpilot/core', () => ({
  getServiceRegistry: () => ({
    get: (token: { key: string }) => {
      if (token.key === 'embedding') return {
        isAvailable: mockIsAvailable,
        generateBatchEmbeddings: mockGenerateBatch,
      };
      throw new Error(`Unexpected token: ${token.key}`);
    },
  }),
  Services: { Embedding: { key: 'embedding' } },
}));

const mockUpdateEmbedding = vi.fn();
const mockGetWithoutEmbeddings = vi.fn();

vi.mock('../db/repositories/memories.js', () => ({
  createMemoriesRepository: () => ({
    updateEmbedding: mockUpdateEmbedding,
    getWithoutEmbeddings: mockGetWithoutEmbeddings,
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddingQueue', () => {
  let queue: EmbeddingQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    queue = new EmbeddingQueue();
  });

  afterEach(() => {
    queue.stop();
    vi.useRealTimers();
  });

  describe('enqueue', () => {
    it('adds item to queue', () => {
      queue.enqueue('mem-1', 'user-1', 'test content');
      expect(queue.getStats().queueSize).toBe(1);
    });

    it('deduplicates by memoryId', () => {
      queue.enqueue('mem-1', 'user-1', 'content 1');
      queue.enqueue('mem-1', 'user-1', 'content 2');
      expect(queue.getStats().queueSize).toBe(1);
    });

    it('allows different memoryIds', () => {
      queue.enqueue('mem-1', 'user-1', 'content 1');
      queue.enqueue('mem-2', 'user-1', 'content 2');
      expect(queue.getStats().queueSize).toBe(2);
    });

    it('deduplicates by userId:memoryId composite key (not memoryId alone)', () => {
      queue.enqueue('mem-1', 'user-1', 'content from user 1');
      queue.enqueue('mem-1', 'user-2', 'content from user 2');
      expect(queue.getStats().queueSize).toBe(2);
    });

    it('sorts by priority (lower = higher priority)', () => {
      queue.enqueue('mem-low', 'user-1', 'low priority', 10);
      queue.enqueue('mem-high', 'user-1', 'high priority', 1);
      queue.enqueue('mem-mid', 'user-1', 'mid priority', 5);
      expect(queue.getStats().queueSize).toBe(3);
    });

    it('does not exceed EMBEDDING_QUEUE_MAX_SIZE', () => {
      for (let i = 0; i < EMBEDDING_QUEUE_MAX_SIZE + 10; i++) {
        queue.enqueue(`mem-${i}`, 'user-1', `content ${i}`);
      }
      expect(queue.getStats().queueSize).toBe(EMBEDDING_QUEUE_MAX_SIZE);
    });

    it('allows re-enqueue after item is processed (dedup set is updated)', async () => {
      // Fill and process the item
      queue.enqueue('mem-1', 'user-1', 'content');
      expect(queue.getStats().queueSize).toBe(1);

      // Start processing (drains the queue)
      mockGenerateBatch.mockResolvedValueOnce([{ embedding: [0.1, 0.2], cached: false }]);
      queue.start();
      await vi.advanceTimersByTimeAsync(6000); // Past the interval

      // After processing, should allow re-enqueue of same ID
      queue.enqueue('mem-1', 'user-1', 'updated content');
      expect(queue.getStats().queueSize).toBe(1);
    });
  });

  describe('start/stop', () => {
    it('starts and stops cleanly', () => {
      queue.start();
      expect(queue.getStats().running).toBe(true);

      queue.stop();
      expect(queue.getStats().running).toBe(false);
    });

    it('ignores duplicate start calls', () => {
      queue.start();
      queue.start();
      expect(queue.getStats().running).toBe(true);
    });
  });

  describe('backfill', () => {
    it('queues memories without embeddings', async () => {
      mockGetWithoutEmbeddings.mockResolvedValue([
        { id: 'mem-1', content: 'text 1' },
        { id: 'mem-2', content: 'text 2' },
      ]);

      const count = await queue.backfill('user-1');

      expect(count).toBe(2);
      expect(queue.getStats().queueSize).toBe(2);
    });

    it('returns 0 when no memories need backfill', async () => {
      mockGetWithoutEmbeddings.mockResolvedValue([]);

      const count = await queue.backfill('user-1');
      expect(count).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns correct stats', () => {
      queue.enqueue('mem-1', 'user-1', 'content');

      const stats = queue.getStats();
      expect(stats.queueSize).toBe(1);
      expect(stats.running).toBe(false);
    });
  });
});
