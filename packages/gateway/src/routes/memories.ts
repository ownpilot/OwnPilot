/**
 * Memories Routes
 *
 * API for managing persistent AI memory.
 * Also provides tool executors for AI to manage memories.
 */

import { Hono } from 'hono';
import type { ApiResponse } from '../types/index.js';
import {
  MemoriesRepository,
  type MemoryType,
  type CreateMemoryInput,
} from '../db/repositories/memories.js';

export const memoriesRoutes = new Hono();

// Get repository instance
function getRepo(userId = 'default'): MemoriesRepository {
  return new MemoriesRepository(userId);
}

// ============================================================================
// Memory Routes
// ============================================================================

/**
 * GET /memories - List memories
 */
memoriesRoutes.get('/', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const type = c.req.query('type') as MemoryType | undefined;
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const minImportance = c.req.query('minImportance')
    ? parseFloat(c.req.query('minImportance')!)
    : undefined;

  const repo = getRepo(userId);
  const memories = await repo.list({
    type,
    limit,
    minImportance,
    orderBy: 'importance',
  });

  const response: ApiResponse = {
    success: true,
    data: {
      memories,
      total: await repo.count(type),
    },
  };

  return c.json(response);
});

/**
 * POST /memories - Create a new memory
 */
memoriesRoutes.post('/', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<CreateMemoryInput>();

  if (!body.content || !body.type) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'content and type are required',
        },
      },
      400
    );
  }

  const repo = getRepo(userId);

  // Check for duplicate
  const existing = await repo.findSimilar(body.content, body.type);
  if (existing) {
    // Boost existing memory instead of creating duplicate
    await repo.boost(existing.id, 0.1);
    const updated = await repo.get(existing.id);
    return c.json({
      success: true,
      data: {
        memory: updated,
        message: 'Similar memory exists, boosted importance instead.',
        deduplicated: true,
      },
    });
  }

  const memory = await repo.create(body);

  const response: ApiResponse = {
    success: true,
    data: {
      memory,
      message: 'Memory created successfully.',
    },
  };

  return c.json(response, 201);
});

/**
 * GET /memories/search - Search memories
 */
memoriesRoutes.get('/search', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const query = c.req.query('q') ?? '';
  const type = c.req.query('type') as MemoryType | undefined;
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  if (!query) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'query (q) parameter is required',
        },
      },
      400
    );
  }

  const repo = getRepo(userId);
  const memories = await repo.search(query, { type, limit });

  const response: ApiResponse = {
    success: true,
    data: {
      query,
      memories,
      count: memories.length,
    },
  };

  return c.json(response);
});

/**
 * GET /memories/stats - Get memory statistics
 */
memoriesRoutes.get('/stats', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getRepo(userId);
  const stats = await repo.getStats();

  const response: ApiResponse = {
    success: true,
    data: stats,
  };

  return c.json(response);
});

/**
 * GET /memories/:id - Get a specific memory
 */
memoriesRoutes.get('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const memory = await repo.get(id);

  if (!memory) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Memory not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: memory,
  };

  return c.json(response);
});

/**
 * PATCH /memories/:id - Update a memory
 */
memoriesRoutes.patch('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<{
    content?: string;
    importance?: number;
    tags?: string[];
  }>();

  const repo = getRepo(userId);
  const updated = await repo.update(id, body);

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Memory not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: updated,
  };

  return c.json(response);
});

/**
 * POST /memories/:id/boost - Boost memory importance
 */
memoriesRoutes.post('/:id/boost', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<{ amount?: number }>().catch((): { amount?: number } => ({}));
  const amount = body.amount ?? 0.1;

  const repo = getRepo(userId);
  const boosted = await repo.boost(id, amount);

  if (!boosted) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Memory not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: {
      memory: boosted,
      message: `Memory importance boosted by ${amount}`,
    },
  };

  return c.json(response);
});

/**
 * DELETE /memories/:id - Delete a memory
 */
memoriesRoutes.delete('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const deleted = await repo.delete(id);

  if (!deleted) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Memory not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: {
      message: 'Memory deleted successfully.',
    },
  };

  return c.json(response);
});

/**
 * POST /memories/decay - Run decay on old memories
 */
memoriesRoutes.post('/decay', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<{
    daysThreshold?: number;
    decayFactor?: number;
  }>().catch((): { daysThreshold?: number; decayFactor?: number } => ({}));

  const repo = getRepo(userId);
  const affected = await repo.decay(body);

  const response: ApiResponse = {
    success: true,
    data: {
      affectedCount: affected,
      message: `Decayed ${affected} memories.`,
    },
  };

  return c.json(response);
});

/**
 * POST /memories/cleanup - Clean up low-importance memories
 */
memoriesRoutes.post('/cleanup', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<{
    maxAge?: number;
    minImportance?: number;
  }>().catch((): { maxAge?: number; minImportance?: number } => ({}));

  const repo = getRepo(userId);
  const deleted = await repo.cleanup(body);

  const response: ApiResponse = {
    success: true,
    data: {
      deletedCount: deleted,
      message: `Cleaned up ${deleted} low-importance memories.`,
    },
  };

  return c.json(response);
});

// ============================================================================
// Tool Executor
// ============================================================================

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute memory tool
 */
export async function executeMemoryTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  const repo = getRepo(userId);

  try {
    switch (toolId) {
      case 'remember': {
        const { content, type, importance, tags } = params as {
          content: string;
          type: MemoryType;
          importance?: number;
          tags?: string[];
        };

        if (!content || !type) {
          return { success: false, error: 'content and type are required' };
        }

        // Check for duplicates
        const existing = await repo.findSimilar(content, type);
        if (existing) {
          await repo.boost(existing.id, 0.1);
          return {
            success: true,
            result: {
              message: 'Similar memory already exists. Boosted its importance instead.',
              memory: await repo.get(existing.id),
              deduplicated: true,
            },
          };
        }

        const memory = await repo.create({
          content,
          type,
          importance: importance ?? 0.5,
          tags,
        });

        return {
          success: true,
          result: {
            message: `Remembered: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
            memory: {
              id: memory.id,
              type: memory.type,
              importance: memory.importance,
            },
          },
        };
      }

      case 'recall': {
        const { query, type, tags, limit = 10 } = params as {
          query: string;
          type?: MemoryType;
          tags?: string[];
          limit?: number;
        };

        if (!query) {
          return { success: false, error: 'query is required' };
        }

        const memories = await repo.list({
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

      case 'forget': {
        const { memoryId } = params as { memoryId: string };

        if (!memoryId) {
          return { success: false, error: 'memoryId is required' };
        }

        const memory = await repo.get(memoryId, false);
        if (!memory) {
          return { success: false, error: `Memory not found: ${memoryId}` };
        }

        await repo.delete(memoryId);

        return {
          success: true,
          result: {
            message: `Forgot: "${memory.content.substring(0, 50)}${memory.content.length > 50 ? '...' : ''}"`,
          },
        };
      }

      case 'list_memories': {
        const { type, limit = 20, minImportance } = params as {
          type?: MemoryType;
          limit?: number;
          minImportance?: number;
        };

        const memories = await repo.list({
          type,
          limit,
          minImportance,
          orderBy: 'importance',
        });

        const total = await repo.count(type);

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

      case 'boost_memory': {
        const { memoryId, amount = 0.1 } = params as {
          memoryId: string;
          amount?: number;
        };

        if (!memoryId) {
          return { success: false, error: 'memoryId is required' };
        }

        const boosted = await repo.boost(memoryId, amount);
        if (!boosted) {
          return { success: false, error: `Memory not found: ${memoryId}` };
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

      case 'memory_stats': {
        const stats = await repo.getStats();

        return {
          success: true,
          result: {
            message: `Memory stats: ${stats.total} total memories, ${stats.recentCount} added this week.`,
            stats,
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolId}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
