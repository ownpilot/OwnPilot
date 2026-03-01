/**
 * Subagent Tools
 *
 * AI-callable tools for spawning, checking, and cancelling ephemeral
 * subagents. These tools enable the chat agent to delegate tasks to
 * child agents that run in parallel and report results back.
 */

import type { ToolDefinition } from '@ownpilot/core';
import { getErrorMessage } from '@ownpilot/core';
import { getSubagentService } from '../services/subagent-service.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const spawnSubagentDef: ToolDefinition = {
  name: 'spawn_subagent',
  workflowUsable: true,
  description: `Spawn an autonomous subagent to handle a specific task in parallel. The subagent runs independently with its own context and tool access, then reports results back.

Use this to:
- Delegate complex subtasks while you continue other work
- Run parallel research on different topics simultaneously
- Break down large problems into independent pieces

The subagent has access to all standard tools (memory, custom data, web, files, etc.) and will work autonomously until the task is complete. You can spawn multiple subagents to work on different aspects simultaneously.

After spawning, use check_subagent or get_subagent_result to retrieve results.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Short name for the subtask (e.g., "Research pricing", "Analyze data")',
      },
      task: {
        type: 'string',
        description:
          'Detailed task description — what the subagent should accomplish. Be specific and clear.',
      },
      context: {
        type: 'string',
        description:
          'Optional additional context from the current conversation to pass to the subagent.',
      },
      allowed_tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional: restrict to specific tool names. If not provided, all tools are available.',
      },
      provider: {
        type: 'string',
        description:
          'AI provider to use (e.g., "anthropic", "openai"). Optional — defaults to system model routing.',
      },
      model: {
        type: 'string',
        description:
          'AI model to use (e.g., "gpt-4o-mini", "claude-sonnet-4-5-20250929"). Optional — defaults to system model routing.',
      },
    },
    required: ['name', 'task'],
  },
  category: 'Subagents',
  tags: ['subagent', 'delegate', 'parallel', 'spawn', 'task'],
};

const checkSubagentDef: ToolDefinition = {
  name: 'check_subagent',
  workflowUsable: true,
  description: `Check the current status of a running subagent. Returns its state (pending, running, completed, failed, cancelled, timeout), progress info, and partial results if available.`,
  parameters: {
    type: 'object',
    properties: {
      subagent_id: {
        type: 'string',
        description: 'The subagent ID returned by spawn_subagent',
      },
    },
    required: ['subagent_id'],
  },
  category: 'Subagents',
  tags: ['subagent', 'check', 'status', 'progress'],
};

const getSubagentResultDef: ToolDefinition = {
  name: 'get_subagent_result',
  workflowUsable: true,
  description: `Get the final result from a completed subagent. If the subagent is still running, returns current status. Use this after check_subagent shows the subagent has finished.`,
  parameters: {
    type: 'object',
    properties: {
      subagent_id: {
        type: 'string',
        description: 'The subagent ID',
      },
    },
    required: ['subagent_id'],
  },
  category: 'Subagents',
  tags: ['subagent', 'result', 'output'],
};

const cancelSubagentDef: ToolDefinition = {
  name: 'cancel_subagent',
  workflowUsable: true,
  description: `Cancel a running subagent. The subagent will stop execution and its state will be set to "cancelled". Any partial results are preserved.`,
  parameters: {
    type: 'object',
    properties: {
      subagent_id: {
        type: 'string',
        description: 'The subagent ID to cancel',
      },
    },
    required: ['subagent_id'],
  },
  category: 'Subagents',
  tags: ['subagent', 'cancel', 'stop', 'abort'],
};

const listSubagentsDef: ToolDefinition = {
  name: 'list_subagents',
  workflowUsable: true,
  description: `List all subagents spawned in the current session, showing their status, progress, and results. Useful for checking on multiple parallel tasks at once.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  category: 'Subagents',
  tags: ['subagent', 'list', 'status', 'all'],
};

export const SUBAGENT_TOOLS: ToolDefinition[] = [
  spawnSubagentDef,
  checkSubagentDef,
  getSubagentResultDef,
  cancelSubagentDef,
  listSubagentsDef,
];

// =============================================================================
// Tool Executor
// =============================================================================

export async function executeSubagentTool(
  toolName: string,
  args: Record<string, unknown>,
  userId?: string,
  conversationId?: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const effectiveUserId = userId ?? 'default';
  const parentId = conversationId ?? 'unknown';

  try {
    const service = getSubagentService();

    switch (toolName) {
      case 'spawn_subagent': {
        const name = args.name as string;
        const task = args.task as string;
        const context = args.context as string | undefined;
        const allowedTools = args.allowed_tools as string[] | undefined;
        const provider = args.provider as string | undefined;
        const model = args.model as string | undefined;

        if (!name || !task) {
          return { success: false, error: 'name and task are required' };
        }

        const session = await service.spawn({
          parentId,
          parentType: 'chat',
          userId: effectiveUserId,
          name,
          task,
          context,
          allowedTools,
          provider,
          model,
        });

        return {
          success: true,
          result: {
            subagentId: session.id,
            name: session.name,
            state: session.state,
            message: `Subagent "${name}" spawned and running. Use check_subagent or get_subagent_result with ID "${session.id}" to retrieve results.`,
          },
        };
      }

      case 'check_subagent': {
        const subagentId = args.subagent_id as string;
        if (!subagentId) {
          return { success: false, error: 'subagent_id is required' };
        }

        const session = service.getSession(subagentId, effectiveUserId);
        if (!session) {
          return { success: false, error: `Subagent ${subagentId} not found` };
        }

        return {
          success: true,
          result: {
            subagentId: session.id,
            name: session.name,
            state: session.state,
            turnsUsed: session.turnsUsed,
            toolCallsUsed: session.toolCallsUsed,
            durationMs: session.durationMs,
            ...(session.state === 'completed' && { result: session.result }),
            ...(session.error && { error: session.error }),
          },
        };
      }

      case 'get_subagent_result': {
        const subagentId = args.subagent_id as string;
        if (!subagentId) {
          return { success: false, error: 'subagent_id is required' };
        }

        const session = service.getResult(subagentId, effectiveUserId);
        if (!session) {
          return { success: false, error: `Subagent ${subagentId} not found` };
        }

        if (session.state === 'pending' || session.state === 'running') {
          return {
            success: true,
            result: {
              subagentId: session.id,
              name: session.name,
              state: session.state,
              message: `Subagent "${session.name}" is still ${session.state}. Check again shortly.`,
              toolCallsUsed: session.toolCallsUsed,
            },
          };
        }

        return {
          success: true,
          result: {
            subagentId: session.id,
            name: session.name,
            state: session.state,
            result: session.result,
            error: session.error,
            toolCallsUsed: session.toolCallsUsed,
            durationMs: session.durationMs,
            provider: session.provider,
            model: session.model,
          },
        };
      }

      case 'cancel_subagent': {
        const subagentId = args.subagent_id as string;
        if (!subagentId) {
          return { success: false, error: 'subagent_id is required' };
        }

        const cancelled = service.cancel(subagentId, effectiveUserId);
        if (!cancelled) {
          return {
            success: false,
            error: `Subagent ${subagentId} not found or already completed`,
          };
        }

        return {
          success: true,
          result: { message: `Subagent ${subagentId} has been cancelled.` },
        };
      }

      case 'list_subagents': {
        const sessions = service.listByParent(parentId, effectiveUserId);

        const subagents = sessions.map((s) => ({
          subagentId: s.id,
          name: s.name,
          state: s.state,
          task: s.task.slice(0, 100) + (s.task.length > 100 ? '...' : ''),
          toolCallsUsed: s.toolCallsUsed,
          durationMs: s.durationMs,
          ...(s.state === 'completed' && {
            resultPreview: s.result?.slice(0, 200) + ((s.result?.length ?? 0) > 200 ? '...' : ''),
          }),
          ...(s.error && { error: s.error }),
        }));

        return {
          success: true,
          result: {
            count: subagents.length,
            active: subagents.filter((s) => s.state === 'running' || s.state === 'pending').length,
            subagents,
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}
