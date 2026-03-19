/**
 * Claw Management Tools
 *
 * AI-callable tools for managing Claw agents from the main chat.
 * These tools let the chat agent create, list, start, stop, and
 * communicate with Claw agents on behalf of the user.
 */

import type { ToolDefinition } from '@ownpilot/core';
import { getErrorMessage } from '@ownpilot/core';
import { getClawService } from '../services/claw-service.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const createClawDef: ToolDefinition = {
  name: 'create_claw',
  workflowUsable: true,
  description: `Create a new Claw autonomous agent. Claws are powerful agents with their own workspace, 250+ tools, CLI access, browser automation, coding agents, and persistent directive files.

Modes:
- **single-shot**: One execution, delivers result, stops. Best for one-off tasks.
- **continuous**: Adaptive loop (500ms-10s). Best for research, monitoring.
- **interval**: Fixed period between cycles (default 5 min). Best for periodic checks.
- **event**: Triggered by EventBus events. Best for reactive automation.

Each claw gets an isolated workspace with .claw/ directive files (INSTRUCTIONS.md, TASKS.md, MEMORY.md, LOG.md) that persist across cycles.`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Display name (e.g., "Market Research Agent")' },
      mission: {
        type: 'string',
        description: 'Detailed mission — what the claw should accomplish',
      },
      mode: {
        type: 'string',
        enum: ['single-shot', 'continuous', 'interval', 'event'],
        description: 'Execution mode (default: single-shot)',
      },
      sandbox: {
        type: 'string',
        enum: ['auto', 'docker', 'local'],
        description: 'Script sandbox (default: auto)',
      },
      provider: { type: 'string', description: 'AI provider (optional)' },
      model: { type: 'string', description: 'AI model (optional)' },
      coding_agent: {
        type: 'string',
        enum: ['claude-code', 'codex', 'gemini-cli'],
        description: 'Coding agent to use (optional)',
      },
      auto_start: {
        type: 'boolean',
        description: 'Start immediately after creation (default: false)',
      },
      skills: {
        type: 'array',
        items: { type: 'string' },
        description: 'Skill IDs to grant access (optional)',
      },
    },
    required: ['name', 'mission'],
  },
  category: 'Claws',
  tags: ['claw', 'create', 'agent', 'autonomous'],
};

const listClawsDef: ToolDefinition = {
  name: 'list_claws',
  workflowUsable: true,
  description:
    'List all Claw agents with their current status, cycles, tool calls, and cost. Shows running, paused, waiting, and stopped claws.',
  parameters: { type: 'object', properties: {} },
  category: 'Claws',
  tags: ['claw', 'list', 'status'],
};

const startClawDef: ToolDefinition = {
  name: 'start_claw',
  workflowUsable: true,
  description:
    'Start a stopped or newly created Claw agent. The claw will begin executing its mission.',
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to start' },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'start', 'run'],
};

const stopClawDef: ToolDefinition = {
  name: 'stop_claw',
  workflowUsable: true,
  description:
    'Stop a running Claw agent. The claw will stop executing and its session will be saved.',
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to stop' },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'stop'],
};

const getClawStatusDef: ToolDefinition = {
  name: 'get_claw_status',
  workflowUsable: true,
  description:
    'Get detailed status of a specific Claw agent including session state, cycles, tool calls, cost, last error, and pending escalation.',
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to check' },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'status', 'info'],
};

const messageClawDef: ToolDefinition = {
  name: 'message_claw',
  workflowUsable: true,
  description:
    "Send a message to a running Claw agent. The message will be included in the claw's next cycle as an inbox item.",
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to message' },
      message: { type: 'string', description: 'Message to send' },
    },
    required: ['claw_id', 'message'],
  },
  category: 'Claws',
  tags: ['claw', 'message', 'communicate'],
};

const getClawHistoryDef: ToolDefinition = {
  name: 'get_claw_history',
  workflowUsable: true,
  description:
    'Get recent execution history of a Claw agent — cycle results, tool calls made, costs, and outputs.',
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID' },
      limit: { type: 'number', description: 'Number of entries (default: 5)' },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'history', 'results'],
};

// =============================================================================
// Exports
// =============================================================================

export const CLAW_MANAGEMENT_TOOLS: ToolDefinition[] = [
  createClawDef,
  listClawsDef,
  startClawDef,
  stopClawDef,
  getClawStatusDef,
  messageClawDef,
  getClawHistoryDef,
];

export const CLAW_MANAGEMENT_TOOL_NAMES = CLAW_MANAGEMENT_TOOLS.map((t) => t.name);

// =============================================================================
// Executor
// =============================================================================

export async function executeClawManagementTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const service = getClawService();

  try {
    switch (toolName) {
      case 'create_claw': {
        const config = await service.createClaw({
          userId,
          name: args.name as string,
          mission: args.mission as string,
          mode: (args.mode as 'single-shot' | 'continuous' | 'interval' | 'event') ?? 'single-shot',
          sandbox: (args.sandbox as 'auto' | 'docker' | 'local') ?? 'auto',
          provider: args.provider as string | undefined,
          model: args.model as string | undefined,
          codingAgentProvider: args.coding_agent as string | undefined,
          autoStart: (args.auto_start as boolean) ?? false,
          skills: args.skills as string[] | undefined,
        });

        // Auto-start if requested
        if (args.auto_start) {
          try {
            await service.startClaw(config.id, userId);
          } catch {
            // Created but failed to start
          }
        }

        return {
          success: true,
          result: {
            id: config.id,
            name: config.name,
            mode: config.mode,
            sandbox: config.sandbox,
            workspaceId: config.workspaceId,
            message: args.auto_start
              ? `Claw "${config.name}" created and started (${config.id})`
              : `Claw "${config.name}" created (${config.id}). Use start_claw to begin execution.`,
          },
        };
      }

      case 'list_claws': {
        const configs = await service.listClaws(userId);
        const sessions = service.listSessions(userId);

        const claws = configs.map((c) => {
          const s = sessions.find((s) => s.config.id === c.id);
          return {
            id: c.id,
            name: c.name,
            mode: c.mode,
            state: s?.state ?? 'stopped',
            cycles: s?.cyclesCompleted ?? 0,
            toolCalls: s?.totalToolCalls ?? 0,
            cost: `$${(s?.totalCostUsd ?? 0).toFixed(4)}`,
            lastCycle: s?.lastCycleAt ?? null,
            codingAgent: c.codingAgentProvider ?? null,
            skills: c.skills?.length ?? 0,
          };
        });

        return {
          success: true,
          result: {
            total: claws.length,
            running: claws.filter((c) => c.state === 'running' || c.state === 'waiting').length,
            claws,
          },
        };
      }

      case 'start_claw': {
        const session = await service.startClaw(args.claw_id as string, userId);
        return {
          success: true,
          result: { state: session.state, message: `Claw started` },
        };
      }

      case 'stop_claw': {
        const stopped = await service.stopClaw(args.claw_id as string, userId);
        return {
          success: stopped,
          result: { message: stopped ? 'Claw stopped' : 'Claw not found or not running' },
        };
      }

      case 'get_claw_status': {
        const config = await service.getClaw(args.claw_id as string, userId);
        if (!config) return { success: false, error: 'Claw not found' };

        const session = service.getSession(args.claw_id as string, userId);
        return {
          success: true,
          result: {
            id: config.id,
            name: config.name,
            mission: config.mission,
            mode: config.mode,
            sandbox: config.sandbox,
            provider: config.provider ?? 'system default',
            model: config.model ?? 'system default',
            codingAgent: config.codingAgentProvider ?? 'none',
            skills: config.skills?.length ?? 0,
            workspaceId: config.workspaceId,
            state: session?.state ?? 'stopped',
            cycles: session?.cyclesCompleted ?? 0,
            toolCalls: session?.totalToolCalls ?? 0,
            cost: `$${(session?.totalCostUsd ?? 0).toFixed(4)}`,
            lastCycle: session?.lastCycleAt ?? null,
            lastError: session?.lastCycleError ?? null,
            artifacts: session?.artifacts?.length ?? 0,
            pendingEscalation: session?.pendingEscalation ?? null,
          },
        };
      }

      case 'message_claw': {
        await service.sendMessage(args.claw_id as string, userId, args.message as string);
        return { success: true, result: { message: 'Message delivered to claw inbox' } };
      }

      case 'get_claw_history': {
        const limit = (args.limit as number) ?? 5;
        const { entries, total } = await service.getHistory(
          args.claw_id as string,
          userId,
          limit,
          0
        );
        return {
          success: true,
          result: {
            total,
            entries: entries.map((e) => ({
              cycle: e.cycleNumber,
              success: e.success,
              toolCalls: e.toolCalls.length,
              tools: e.toolCalls.map((t) => t.tool),
              output: e.outputMessage.slice(0, 500),
              cost: e.costUsd ? `$${e.costUsd.toFixed(4)}` : null,
              duration: `${(e.durationMs / 1000).toFixed(1)}s`,
              error: e.error ?? null,
              executedAt: e.executedAt,
            })),
          },
        };
      }

      default:
        return { success: false, error: `Unknown claw management tool: ${toolName}` };
    }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
