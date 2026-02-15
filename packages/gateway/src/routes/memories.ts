/**
 * Memories Routes
 *
 * API for managing persistent AI memory.
 * Also provides tool executors for AI to manage memories.
 *
 * All business logic is delegated to MemoryService.
 */

import { Hono } from 'hono';
import type {
  MemoryType,
  CreateMemoryInput,
} from '../db/repositories/memories.js';
import { MemoryServiceError } from '../services/memory-service.js';
import { getServiceRegistry, Services } from '@ownpilot/core';
import { getUserId, apiResponse, apiError, getIntParam, ERROR_CODES, sanitizeId, notFoundError, truncate, validateQueryEnum, getErrorMessage } from './helpers.js';
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
  const userId = getUserId(c);
  const type = validateQueryEnum(c.req.query('type'), ['fact', 'preference', 'conversation', 'event', 'skill'] as const);
  const limit = getIntParam(c, 'limit', 20, 1, 100);
  const rawMinImportance = c.req.query('minImportance');
  const minImportance = rawMinImportance !== undefined
    ? Math.max(0, Math.min(1, parseFloat(rawMinImportance) || 0))
    : undefined;

  const service = getServiceRegistry().get(Services.Memory);
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
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, createMemorySchema } = await import('../middleware/validation.js');
  const body = validateBody(createMemorySchema, rawBody) as unknown as CreateMemoryInput;

  try {
    const service = getServiceRegistry().get(Services.Memory);
    const { memory, deduplicated } = await service.rememberMemory(userId, body);

    if (deduplicated) {
      log.info('Memory deduplicated', { userId, memoryId: memory.id, type: memory.type });
      return apiResponse(c, {
        memory,
        message: 'Similar memory exists, boosted importance instead.',
        deduplicated: true,
      });
    }

    log.info('Memory created', { userId, memoryId: memory.id, type: memory.type, importance: memory.importance });
    return apiResponse(c, {
        memory,
        message: 'Memory created successfully.',
      }, 201);
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
  const userId = getUserId(c);
  const query = c.req.query('q') ?? '';
  const type = validateQueryEnum(c.req.query('type'), ['fact', 'preference', 'conversation', 'event', 'skill'] as const);
  const limit = getIntParam(c, 'limit', 20, 1, 100);

  if (!query) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'query (q) parameter is required' }, 400);
  }

  const service = getServiceRegistry().get(Services.Memory);
  const memories = await service.searchMemories(userId, query, { type, limit });

  log.info('Memory search', { userId, query, type, resultsCount: memories.length });
  return apiResponse(c, {
      query,
      memories,
      count: memories.length,
    });
});

/**
 * GET /memories/stats - Get memory statistics
 */
memoriesRoutes.get('/stats', async (c) => {
  const userId = getUserId(c);
  const service = getServiceRegistry().get(Services.Memory);
  const stats = await service.getStats(userId);

  return apiResponse(c, stats);
});

/**
 * GET /memories/:id - Get a specific memory
 */
memoriesRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getServiceRegistry().get(Services.Memory);
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
  const userId = getUserId(c);
  const id = c.req.param('id');
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, updateMemorySchema } = await import('../middleware/validation.js');
  const body = validateBody(updateMemorySchema, rawBody) as {
    content?: string;
    importance?: number;
    tags?: string[];
  };

  if (body.importance !== undefined && (typeof body.importance !== 'number' || !Number.isFinite(body.importance) || body.importance < 0 || body.importance > 1)) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'importance must be a finite number between 0 and 1' }, 400);
  }

  const service = getServiceRegistry().get(Services.Memory);
  const updated = await service.updateMemory(userId, id, body);

  if (!updated) {
    return notFoundError(c, 'Memory', id);
  }

  return apiResponse(c, updated);
});

/**
 * POST /memories/:id/boost - Boost memory importance
 */
memoriesRoutes.post('/:id/boost', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const rawBody = await c.req.json().catch(() => ({}));
  const { validateBody, boostMemorySchema } = await import('../middleware/validation.js');
  const body = validateBody(boostMemorySchema, rawBody) as { amount?: number };
  const amount = body.amount ?? 0.1;

  if (typeof amount !== 'number' || amount <= 0 || amount > 1) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'amount must be a number between 0 and 1' }, 400);
  }

  const service = getServiceRegistry().get(Services.Memory);
  const boosted = await service.boostMemory(userId, id, amount);

  if (!boosted) {
    return notFoundError(c, 'Memory', id);
  }

  return apiResponse(c, {
      memory: boosted,
      message: `Memory importance boosted by ${amount}`,
    });
});

/**
 * DELETE /memories/:id - Delete a memory
 */
memoriesRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getServiceRegistry().get(Services.Memory);
  const deleted = await service.deleteMemory(userId, id);

  if (!deleted) {
    log.warn('Memory not found for deletion', { userId, memoryId: id });
    return notFoundError(c, 'Memory', id);
  }

  log.info('Memory deleted', { userId, memoryId: id });
  return apiResponse(c, {
      message: 'Memory deleted successfully.',
    });
});

/**
 * POST /memories/decay - Run decay on old memories
 */
memoriesRoutes.post('/decay', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => ({}));
  const { validateBody, decayMemoriesSchema } = await import('../middleware/validation.js');
  const body = validateBody(decayMemoriesSchema, rawBody) as {
    daysThreshold?: number;
    decayFactor?: number;
  };

  const service = getServiceRegistry().get(Services.Memory);
  const affected = await service.decayMemories(userId, body);

  return apiResponse(c, {
      affectedCount: affected,
      message: `Decayed ${affected} memories.`,
    });
});

/**
 * POST /memories/cleanup - Clean up low-importance memories
 */
memoriesRoutes.post('/cleanup', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json().catch(() => ({}));
  const { validateBody, cleanupMemoriesSchema } = await import('../middleware/validation.js');
  const body = validateBody(cleanupMemoriesSchema, rawBody) as {
    maxAge?: number;
    minImportance?: number;
  };

  const service = getServiceRegistry().get(Services.Memory);
  const deleted = await service.cleanupMemories(userId, body);

  return apiResponse(c, {
      deletedCount: deleted,
      message: `Cleaned up ${deleted} low-importance memories.`,
    });
});

// ============================================================================
// Tool Executor
// ============================================================================

import type { ToolExecutionResult } from '../services/tool-executor.js';

/**
 * Execute memory tool - delegates to MemoryService
 */
export async function executeMemoryTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  const service = getServiceRegistry().get(Services.Memory);

  try {
    switch (toolId) {
      case 'create_memory': {
        const { content, type, importance, tags } = params as {
          content: string;
          type: MemoryType;
          importance?: number;
          tags?: string[];
        };

        if (!content || !type) {
          return { success: false, error: 'content and type are required' };
        }

        const { memory, deduplicated } = await service.rememberMemory(userId, {
          content,
          type,
          importance: importance ?? 0.5,
          tags,
        });

        if (deduplicated) {
          return {
            success: true,
            result: {
              message: 'Similar memory already exists. Boosted its importance instead.',
              memory,
              deduplicated: true,
            },
          };
        }

        return {
          success: true,
          result: {
            message: `Remembered: "${truncate(content)}"`,
            memory: {
              id: memory.id,
              type: memory.type,
              importance: memory.importance,
            },
          },
        };
      }

      case 'batch_create_memories': {
        const { memories: memoriesInput } = params as {
          memories: Array<{
            content: string;
            type: MemoryType;
            importance?: number;
            tags?: string[];
          }>;
        };

        if (!memoriesInput || !Array.isArray(memoriesInput)) {
          return { success: false, error: 'memories must be an array' };
        }

        const results = await service.batchRemember(
          userId,
          memoriesInput.map((m) => ({
            content: m.content,
            type: m.type,
            importance: m.importance ?? 0.5,
            tags: m.tags,
          })),
        );

        return {
          success: true,
          result: {
            message: `Processed ${memoriesInput.length} memories: ${results.created} created, ${results.deduplicated} deduplicated.`,
            created: results.created,
            deduplicated: results.deduplicated,
            memories: results.memories.map((m) => ({
              id: m.id,
              type: m.type,
              importance: m.importance,
            })),
          },
        };
      }

      case 'search_memories': {
        const { query, type, tags, limit: rawLimit = 10 } = params as {
          query: string;
          type?: MemoryType;
          tags?: string[];
          limit?: number;
        };

        if (!query) {
          return { success: false, error: 'query is required' };
        }

        const limit = Math.max(1, Math.min(100, rawLimit));
        const memories = await service.listMemories(userId, {
          search: query,
          type,
          tags,
          limit,
          orderBy: 'relevance',
        });

        if (memories.length === 0) {
          return {
            success: true,
            result: {
              message: `No memories found matching "${query}".`,
              memories: [],
            },
          };
        }

        return {
          success: true,
          result: {
            message: `Found ${memories.length} relevant memories.`,
            memories: memories.map((m) => ({
              id: m.id,
              type: m.type,
              content: m.content,
              importance: m.importance,
              createdAt: m.createdAt,
            })),
          },
        };
      }

      case 'delete_memory': {
        const { memoryId } = params as { memoryId: string };

        if (!memoryId) {
          return { success: false, error: 'memoryId is required' };
        }

        const memory = await service.getMemory(userId, memoryId, false);
        if (!memory) {
          return { success: false, error: `Memory not found: ${sanitizeId(memoryId)}` };
        }

        await service.deleteMemory(userId, memoryId);

        return {
          success: true,
          result: {
            message: `Forgot: "${truncate(memory.content)}"`,
          },
        };
      }

      case 'list_memories': {
        const { type, limit = 20, minImportance } = params as {
          type?: MemoryType;
          limit?: number;
          minImportance?: number;
        };

        const memories = await service.listMemories(userId, {
          type,
          limit,
          minImportance,
          orderBy: 'importance',
        });

        const total = await service.countMemories(userId, type);

        return {
          success: true,
          result: {
            message: `Found ${total} memories${type ? ` of type "${type}"` : ''}. Showing ${memories.length}.`,
            memories: memories.map((m) => ({
              id: m.id,
              type: m.type,
              content: m.content,
              importance: m.importance,
              tags: m.tags,
              createdAt: m.createdAt,
            })),
            total,
          },
        };
      }

      case 'update_memory_importance': {
        const { memoryId, amount = 0.1 } = params as {
          memoryId: string;
          amount?: number;
        };

        if (!memoryId) {
          return { success: false, error: 'memoryId is required' };
        }

        const boosted = await service.boostMemory(userId, memoryId, amount);
        if (!boosted) {
          return { success: false, error: `Memory not found: ${sanitizeId(memoryId)}` };
        }

        return {
          success: true,
          result: {
            message: `Boosted memory importance to ${boosted.importance.toFixed(2)}.`,
            memory: {
              id: boosted.id,
              content: boosted.content,
              importance: boosted.importance,
            },
          },
        };
      }

      case 'get_memory_stats': {
        const stats = await service.getStats(userId);

        return {
          success: true,
          result: {
            message: `Memory stats: ${stats.total} total memories, ${stats.recentCount} added this week.`,
            stats,
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${sanitizeId(toolId)}` };
    }
  } catch (err) {
    if (err instanceof MemoryServiceError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: getErrorMessage(err),
    };
  }
}
