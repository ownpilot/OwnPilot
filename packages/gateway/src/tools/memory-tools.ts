/**
 * Memory Tool Executor
 *
 * Execute the LLM-facing memory tools (create_memory, search_memories,
 * delete_memory, etc.) by delegating to MemoryService.
 *
 * Extracted from `routes/memories.ts` so the tool registry doesn't have to
 * reach back into the routes/ layer for executors. `routes/memories.ts`
 * keeps the REST API for human-facing CRUD; this module is the agent path.
 */

import { getMemoryService } from '@ownpilot/core';
import type { MemoryType } from '../db/repositories/memories.js';
import { MemoryServiceError } from '../services/memory-service.js';
import { sanitizeId, truncate, getErrorMessage } from '../utils/common.js';
import type { ToolExecutionResult } from '../services/tool/executor.js';

/**
 * Execute memory tool — delegates to MemoryService.
 */
export async function executeMemoryTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  const service = getMemoryService();

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
          }))
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
        const {
          query,
          type,
          tags,
          limit: rawLimit = 10,
        } = params as {
          query: string;
          type?: MemoryType;
          tags?: string[];
          limit?: number;
        };

        if (!query) {
          return { success: false, error: 'query is required' };
        }

        const limit = Math.max(1, Math.min(100, rawLimit));

        const results = await service.hybridSearch(userId, query, { type, limit });

        const filtered =
          tags && tags.length > 0
            ? results.filter((m) => tags.some((tag) => m.tags.includes(tag)))
            : results;

        if (filtered.length === 0) {
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
            message: `Found ${filtered.length} relevant memories.`,
            memories: filtered.map((m) => ({
              id: m.id,
              type: m.type,
              content: m.content,
              importance: m.importance,
              score: m.score,
              matchType: m.matchType,
              createdAt: m.createdAt,
            })),
          },
        };
      }

      case 'recall_memory': {
        const { query, limit: rawLimit = 8 } = params as { query: string; limit?: number };
        if (!query) {
          return { success: false, error: 'query is required' };
        }
        const limit = Math.max(1, Math.min(30, rawLimit));

        // Build a one-shot, tool-less completion fn for summarization.
        const { createConfiguredAgent } = await import('../services/agent/runner-utils.js');
        const { getLLMRouter } = await import('@ownpilot/core');
        const complete = async (prompt: string): Promise<string> => {
          const { provider, model } = await getLLMRouter().pick({
            process: 'pulse',
            errorContext: 'recall_memory',
          });
          const agent = await createConfiguredAgent({
            name: 'memory-recall',
            provider,
            model,
            systemPrompt: 'You answer strictly from the supplied memories. Be concise.',
            userId,
            conversationId: `recall-${Date.now()}`,
            toolFilter: [],
            maxTurns: 1,
            temperature: 0,
          });
          const res = await agent.chat(prompt);
          if (!res.ok) throw new Error(getErrorMessage(res.error));
          return res.value.content;
        };

        const { getMemoryEngine } = await import('../services/memory/engine.js');
        const recall = await getMemoryEngine().recall(userId, query, complete, limit);

        return {
          success: true,
          result: {
            summary: recall.summary,
            sources: recall.sources.map((s) => ({ id: s.id, content: truncate(s.content) })),
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
        const {
          type,
          limit = 20,
          minImportance,
        } = params as {
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
