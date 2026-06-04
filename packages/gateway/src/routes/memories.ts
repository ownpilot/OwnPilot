/**
 * Memories Routes
 *
 * API for managing persistent AI memory.
 * Also provides tool executors for AI to manage memories.
 *
 * All business logic is delegated to MemoryService.
 */

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import type { CreateMemoryInput } from '../db/repositories/memories.js';
import { MemoryServiceError } from '../services/memory-service.js';
import { getMemoryService } from '@ownpilot/core';
import {
  apiResponse,
  apiError,
  getIntParam,
  ERROR_CODES,
  notFoundError,
  validateQueryEnum,
  getErrorMessage,
  parseJsonBody,
} from './helpers.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';

const log = getLog('Memories');

export const memoriesRoutes = new Hono();

// ============================================================================
// Memory Routes
// ============================================================================

/**
 * GET /memories - List memories
 */
memoriesRoutes.get('/', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const type = validateQueryEnum(c.req.query('type'), [
    'fact',
    'preference',
    'conversation',
    'event',
    'skill',
  ] as const);
  const limit = getIntParam(c, 'limit', 20, 1, 100);
  const rawMinImportance = c.req.query('minImportance');
  const minImportance =
    rawMinImportance !== undefined
      ? Math.max(0, Math.min(1, parseFloat(rawMinImportance) || 0))
      : undefined;

  const service = getMemoryService();
  const memories = await service.listMemories(userId, {
    type,
    limit,
    minImportance,
    orderBy: 'importance',
  });

  return apiResponse(c, {
    memories,
    total: await service.countMemories(userId, type),
  });
});

/**
 * POST /memories - Create a new memory (with deduplication)
 */
memoriesRoutes.post('/', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const rawBody = await parseJsonBody(c);
  const { validateBody, createMemorySchema } = await import('../middleware/validation.js');
  const body = validateBody(createMemorySchema, rawBody) as unknown as CreateMemoryInput;

  try {
    const service = getMemoryService();
    const { memory, deduplicated } = await service.rememberMemory(userId, body);

    if (deduplicated) {
      log.info('Memory deduplicated', { userId, memoryId: memory.id, type: memory.type });
      wsGateway.broadcast('data:changed', { entity: 'memory', action: 'updated', id: memory.id });
      return apiResponse(c, {
        memory,
        message: 'Similar memory exists, boosted importance instead.',
        deduplicated: true,
      });
    }

    log.info('Memory created', {
      userId,
      memoryId: memory.id,
      type: memory.type,
      importance: memory.importance,
    });
    wsGateway.broadcast('data:changed', { entity: 'memory', action: 'created', id: memory.id });
    return apiResponse(
      c,
      {
        memory,
        message: 'Memory created successfully.',
      },
      201
    );
  } catch (err) {
    if (err instanceof MemoryServiceError && err.code === 'VALIDATION_ERROR') {
      log.warn('Memory validation error', { userId, error: err.message });
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: err.message }, 400);
    }
    log.error('Memory creation error', { userId, error: getErrorMessage(err) });
    throw err;
  }
});

/**
 * GET /memories/search - Search memories
 */
memoriesRoutes.get('/search', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const query = c.req.query('q') ?? '';
  const type = validateQueryEnum(c.req.query('type'), [
    'fact',
    'preference',
    'conversation',
    'event',
    'skill',
  ] as const);
  const limit = getIntParam(c, 'limit', 20, 1, 100);
  const mode = c.req.query('mode') ?? 'hybrid';

  if (!query) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'query (q) parameter is required' },
      400
    );
  }

  const service = getMemoryService();

  if (mode === 'hybrid' || mode === 'vector') {
    const memories = await service.hybridSearch(userId, query, { type, limit });
    log.info('Hybrid memory search', { userId, query, type, mode, resultsCount: memories.length });
    return apiResponse(c, { query, mode, memories, count: memories.length });
  }

  // Fallback to existing text search for 'keyword' mode
  const memories = await service.searchMemories(userId, query, { type, limit });
  log.info('Memory search', { userId, query, type, mode, resultsCount: memories.length });
  return apiResponse(c, { query, mode, memories, count: memories.length });
});

/**
 * GET /memories/stats - Get memory statistics
 */
memoriesRoutes.get('/stats', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const service = getMemoryService();
  const stats = await service.getStats(userId);

  return apiResponse(c, stats);
});

/**
 * GET /memories/embedding-stats - Get embedding system stats
 *
 * NOTE: must be registered before GET /:id, otherwise the parameterized
 * route captures "embedding-stats" as an :id and returns 404.
 */
memoriesRoutes.get('/embedding-stats', async (c) => {
  const { getEmbeddingService } = await import('../services/embedding/service.js');
  const { getEmbeddingQueue } = await import('../services/embedding/queue.js');
  const { embeddingCacheRepo } = await import('../db/repositories/embedding-cache.js');

  const embeddingService = getEmbeddingService();
  const queue = getEmbeddingQueue();
  const cacheStats = await embeddingCacheRepo.getStats();

  return apiResponse(c, {
    available: embeddingService.isAvailable(),
    queue: queue.getStats(),
    cache: cacheStats,
  });
});

/**
 * GET /memories/:id - Get a specific memory
 */
memoriesRoutes.get('/:id', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  const service = getMemoryService();
  const memory = await service.getMemory(userId, id);

  if (!memory) {
    return notFoundError(c, 'Memory', id);
  }

  return apiResponse(c, memory);
});

/**
 * PATCH /memories/:id - Update a memory
 */
memoriesRoutes.patch('/:id', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');
  const rawBody = await parseJsonBody(c);
  const { validateBody, updateMemorySchema } = await import('../middleware/validation.js');
  const body = validateBody(updateMemorySchema, rawBody) as {
    content?: string;
    importance?: number;
    tags?: string[];
  };

  if (
    body.importance !== undefined &&
    (typeof body.importance !== 'number' ||
      !Number.isFinite(body.importance) ||
      body.importance < 0 ||
      body.importance > 1)
  ) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: 'importance must be a finite number between 0 and 1',
      },
      400
    );
  }

  const service = getMemoryService();
  const updated = await service.updateMemory(userId, id, body);

  if (!updated) {
    return notFoundError(c, 'Memory', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'memory', action: 'updated', id });

  return apiResponse(c, updated);
});

/**
 * POST /memories/:id/boost - Boost memory importance
 */
memoriesRoutes.post('/:id/boost', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');
  const rawBody = (await parseJsonBody(c)) ?? {};
  const { validateBody, boostMemorySchema } = await import('../middleware/validation.js');
  const body = validateBody(boostMemorySchema, rawBody) as { amount?: number };
  const amount = body.amount ?? 0.1;

  if (typeof amount !== 'number' || amount <= 0 || amount > 1) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_INPUT, message: 'amount must be a number between 0 and 1' },
      400
    );
  }

  const service = getMemoryService();
  const boosted = await service.boostMemory(userId, id, amount);

  if (!boosted) {
    return notFoundError(c, 'Memory', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'memory', action: 'updated', id });

  return apiResponse(c, {
    memory: boosted,
    message: `Memory importance boosted by ${amount}`,
  });
});

/**
 * DELETE /memories/:id - Delete a memory
 */
memoriesRoutes.delete('/:id', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  const service = getMemoryService();
  const deleted = await service.deleteMemory(userId, id);

  if (!deleted) {
    log.warn('Memory not found for deletion', { userId, memoryId: id });
    return notFoundError(c, 'Memory', id);
  }

  log.info('Memory deleted', { userId, memoryId: id });
  wsGateway.broadcast('data:changed', { entity: 'memory', action: 'deleted', id });
  return apiResponse(c, {
    message: 'Memory deleted successfully.',
  });
});

/**
 * POST /memories/decay - Run decay on old memories
 */
memoriesRoutes.post('/decay', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const rawBody = (await parseJsonBody(c)) ?? {};
  const { validateBody, decayMemoriesSchema } = await import('../middleware/validation.js');
  const body = validateBody(decayMemoriesSchema, rawBody) as {
    daysThreshold?: number;
    decayFactor?: number;
  };

  const service = getMemoryService();
  const affected = await service.decayMemories(userId, body);

  if (affected > 0) wsGateway.broadcast('data:changed', { entity: 'memory', action: 'updated' });

  return apiResponse(c, {
    affectedCount: affected,
    message: `Decayed ${affected} memories.`,
  });
});

/**
 * POST /memories/cleanup - Clean up low-importance memories
 */
memoriesRoutes.post('/cleanup', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const rawBody = (await parseJsonBody(c)) ?? {};
  const { validateBody, cleanupMemoriesSchema } = await import('../middleware/validation.js');
  const body = validateBody(cleanupMemoriesSchema, rawBody) as {
    maxAge?: number;
    minImportance?: number;
  };

  const service = getMemoryService();
  const deleted = await service.cleanupMemories(userId, body);

  if (deleted > 0) wsGateway.broadcast('data:changed', { entity: 'memory', action: 'deleted' });

  return apiResponse(c, {
    deletedCount: deleted,
    message: `Cleaned up ${deleted} low-importance memories.`,
  });
});

/**
 * POST /memories/backfill-embeddings - Queue all memories without embeddings
 */
memoriesRoutes.post('/backfill-embeddings', async (c) => {
  const userId = LOCAL_OWNER_ID;

  const { getEmbeddingQueue } = await import('../services/embedding/queue.js');
  const queued = await getEmbeddingQueue().backfill(userId);

  log.info('Embedding backfill queued', { userId, count: queued });
  return apiResponse(c, {
    queued,
    message: `Queued ${queued} memories for embedding generation.`,
  });
});

// ============================================================================
// Tool Executor
// ============================================================================
// Moved to tools/memory-tools.ts. Re-exported here for legacy callers.
export { executeMemoryTool } from '../tools/memory-tools.js';
