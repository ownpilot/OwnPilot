/**
 * Background Embedding Queue
 *
 * Simple in-process queue for asynchronous embedding generation.
 * Processes memories that need embeddings in the background
 * without blocking memory creation.
 */

import { getServiceRegistry, getEventSystem, Services } from '@ownpilot/core';
import { getLog } from './log.js';
import { createMemoriesRepository } from '../db/repositories/memories.js';
import {
  EMBEDDING_BACKFILL_LIMIT,
  EMBEDDING_QUEUE_BATCH_SIZE,
  EMBEDDING_QUEUE_INTERVAL_MS,
  EMBEDDING_QUEUE_MAX_SIZE,
} from '../config/defaults.js';

const log = getLog('EmbeddingQueue');

// ============================================================================
// Types
// ============================================================================

interface QueueItem {
  memoryId: string;
  userId: string;
  content: string;
  priority: number; // Lower = higher priority
}

// Max priority level before dropping (prevents infinite re-queue)
const MAX_PRIORITY = 20;

// ============================================================================
// Queue
// ============================================================================

export class EmbeddingQueue {
  private queue: QueueItem[] = [];
  private queuedIds = new Set<string>(); // O(1) dedup lookup (composite key: userId:memoryId)
  private processing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private queueKey(memoryId: string, userId: string): string {
    return `${userId}:${memoryId}`;
  }

  /**
   * Start the background worker and subscribe to memory events.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      this.processNextBatch().catch((err) => {
        log.error('Queue processing error', String(err));
      });
    }, EMBEDDING_QUEUE_INTERVAL_MS);

    // Subscribe to memory events for automatic embedding generation
    const eventSystem = getEventSystem();
    eventSystem.on('memory.created', (event) => {
      if (event.data.needsEmbedding) {
        this.enqueue(event.data.memoryId, event.data.userId, event.data.content);
      }
    });
    eventSystem.on('memory.updated', (event) => {
      if (event.data.needsEmbedding && event.data.content) {
        this.enqueue(event.data.memoryId, event.data.userId, event.data.content);
      }
    });

    log.info('Embedding queue started');
  }

  /**
   * Stop the background worker.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('Embedding queue stopped');
  }

  /**
   * Add a memory to the embedding queue.
   */
  enqueue(memoryId: string, userId: string, content: string, priority = 5): void {
    // Deduplicate: O(1) check via Set (composite key to avoid cross-user collisions)
    const key = this.queueKey(memoryId, userId);
    if (this.queuedIds.has(key)) return;

    // Cap queue size to prevent unbounded growth
    if (this.queue.length >= EMBEDDING_QUEUE_MAX_SIZE) return;

    this.queuedIds.add(key);
    this.queue.push({ memoryId, userId, content, priority });

    // Sort by priority (lower number = higher priority)
    this.queue.sort((a, b) => a.priority - b.priority);

    log.debug('Enqueued memory for embedding', { memoryId, queueSize: this.queue.length });
  }

  /**
   * Backfill: queue all memories that don't have embeddings yet.
   */
  async backfill(userId: string): Promise<number> {
    const repo = createMemoriesRepository(userId);
    const memories = await repo.getWithoutEmbeddings(EMBEDDING_BACKFILL_LIMIT);

    let count = 0;
    for (const memory of memories) {
      this.enqueue(memory.id, userId, memory.content, 10); // Low priority
      count++;
    }

    if (count > 0) {
      log.info(`Backfill queued ${count} memories for embedding`, { userId });
    }
    return count;
  }

  /**
   * Process the next batch of items from the queue.
   */
  private async processNextBatch(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    try {
      const embeddingService = getServiceRegistry().get(Services.Embedding);

      // Check if embedding service is available
      if (!embeddingService.isAvailable()) {
        return;
      }

      // Take a batch from the queue (keep in dedup Set until processed)
      const batch = this.queue.splice(0, EMBEDDING_QUEUE_BATCH_SIZE);
      const texts = batch.map((item) => item.content);

      // Generate embeddings in batch
      let results: Awaited<ReturnType<typeof embeddingService.generateBatchEmbeddings>>;
      try {
        results = await embeddingService.generateBatchEmbeddings(texts);
      } catch (err) {
        // Batch generation failed — re-enqueue all items with lower priority
        log.warn('Batch embedding generation failed, re-enqueueing', {
          batchSize: batch.length,
          error: String(err),
        });
        for (const item of batch) {
          this.queuedIds.delete(this.queueKey(item.memoryId, item.userId));
          if (item.priority < MAX_PRIORITY) {
            this.enqueue(item.memoryId, item.userId, item.content, item.priority + 5);
          }
        }
        return;
      }

      // Update each memory with its embedding (reuse repos per userId)
      const repoCache = new Map<string, ReturnType<typeof createMemoriesRepository>>();
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i]!;
        const result = results[i]!;
        const key = this.queueKey(item.memoryId, item.userId);

        if (result.embedding.length === 0) {
          this.queuedIds.delete(key);
          continue;
        }

        try {
          let repo = repoCache.get(item.userId);
          if (!repo) {
            repo = createMemoriesRepository(item.userId);
            repoCache.set(item.userId, repo);
          }
          await repo.updateEmbedding(item.memoryId, result.embedding);
          this.queuedIds.delete(key);

          log.debug('Embedding generated', {
            memoryId: item.memoryId,
            cached: result.cached,
          });
        } catch (err) {
          this.queuedIds.delete(key);
          log.warn('Failed to update memory embedding', {
            memoryId: item.memoryId,
            error: String(err),
          });
          // Re-queue with lower priority on failure
          if (item.priority < MAX_PRIORITY) {
            this.enqueue(item.memoryId, item.userId, item.content, item.priority + 5);
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Get queue statistics.
   */
  getStats(): { queueSize: number; running: boolean } {
    return {
      queueSize: this.queue.length,
      running: this.running,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: EmbeddingQueue | null = null;

export function getEmbeddingQueue(): EmbeddingQueue {
  if (!instance) {
    instance = new EmbeddingQueue();
  }
  return instance;
}
