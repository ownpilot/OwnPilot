/**
 * Fleet Tools
 *
 * AI-callable tools for creating and managing fleets — coordinated groups
 * of background workers that can use AI chat, CLI tools, APIs, and MCP.
 */

import type { ToolDefinition } from '@ownpilot/core';
import { getErrorMessage } from '@ownpilot/core';
import { getFleetService } from '../services/fleet-service.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const createFleetDef: ToolDefinition = {
  name: 'create_fleet',
  workflowUsable: true,
  description: `Create and optionally start a fleet — a coordinated group of workers that run continuously in the background.

Worker types:
- **ai-chat**: Full Agent engine with 250+ tools (memory, goals, triggers, browser, etc.)
- **coding-cli**: CLI tools (claude-code, codex, gemini-cli) for code generation and refactoring
- **api-call**: Direct AI provider API (lightweight, no tools — good for analysis/classification)
- **mcp-bridge**: MCP server tool calls (connect to external services)

Schedule types:
- **continuous**: Fast loop (1-10s delay). Best for urgent work.
- **interval**: Fixed period between cycles. Best for periodic tasks.
- **on-demand**: Manual trigger only. Best for task queues.
- **event**: Reactive — triggers on EventBus events.

Each fleet has a task queue. Add tasks and workers pick them up automatically.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Short name for the fleet (e.g., "Code Review Army", "Data Pipeline")',
      },
      mission: {
        type: 'string',
        description: 'High-level mission — what this fleet should accomplish',
      },
      workers: {
        type: 'array',
        description: 'Worker configurations',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Unique worker name' },
            type: {
              type: 'string',
              enum: ['ai-chat', 'coding-cli', 'api-call', 'mcp-bridge', 'claw'],
              description: 'Worker engine type',
            },
            description: { type: 'string', description: 'What this worker does' },
            provider: { type: 'string', description: 'AI provider (for ai-chat/api-call)' },
            model: { type: 'string', description: 'AI model (for ai-chat/api-call)' },
            system_prompt: {
              type: 'string',
              description: 'Custom system prompt (for ai-chat/api-call)',
            },
            cli_provider: {
              type: 'string',
              description: 'CLI tool (for coding-cli): claude-code, codex, gemini-cli',
            },
            cwd: { type: 'string', description: 'Working directory (for coding-cli)' },
            mcp_server: { type: 'string', description: 'MCP server name (for mcp-bridge)' },
            mcp_tools: {
              type: 'array',
              items: { type: 'string' },
              description: 'MCP tool names to call (for mcp-bridge)',
            },
            allowed_tools: {
              type: 'array',
              items: { type: 'string' },
              description: 'Restrict to specific tools (for ai-chat)',
            },
          },
          required: ['name', 'type'],
        },
      },
      schedule_type: {
        type: 'string',
        enum: ['continuous', 'interval', 'on-demand', 'event', 'cron'],
        description: 'How the fleet cycles (default: on-demand)',
      },
      interval_minutes: {
        type: 'number',
        description: 'For interval mode: minutes between cycles (default: 1)',
      },
      concurrency_limit: {
        type: 'number',
        description: 'Max parallel workers (default: 5)',
      },
      auto_start: {
        type: 'boolean',
        description: 'Start fleet immediately after creation (default: true)',
      },
      provider: { type: 'string', description: 'Default AI provider for workers' },
      model: { type: 'string', description: 'Default AI model for workers' },
    },
    required: ['name', 'mission', 'workers'],
  },
  category: 'Fleet',
  tags: ['fleet', 'agent', 'army', 'spawn', 'background', 'worker'],
};

const startFleetDef: ToolDefinition = {
  name: 'start_fleet',
  workflowUsable: true,
  description: 'Start a fleet that is not currently running.',
  parameters: {
    type: 'object',
    properties: {
      fleet_id: { type: 'string', description: 'Fleet ID to start' },
    },
    required: ['fleet_id'],
  },
  category: 'Fleet',
  tags: ['fleet', 'start'],
};

const stopFleetDef: ToolDefinition = {
  name: 'stop_fleet',
  workflowUsable: true,
  description: 'Stop a running fleet. All workers will be stopped gracefully.',
  parameters: {
    type: 'object',
    properties: {
      fleet_id: { type: 'string', description: 'Fleet ID to stop' },
    },
    required: ['fleet_id'],
  },
  category: 'Fleet',
  tags: ['fleet', 'stop'],
};

const addFleetTaskDef: ToolDefinition = {
  name: 'add_fleet_task',
  workflowUsable: true,
  description: `Add one or more tasks to a fleet's queue. Workers will pick them up automatically based on assignment or round-robin. Tasks support dependencies — a task won't start until its dependencies are completed.`,
  parameters: {
    type: 'object',
    properties: {
      fleet_id: { type: 'string', description: 'Fleet ID to add tasks to' },
      tasks: {
        type: 'array',
        description: 'Tasks to add',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short task title' },
            description: {
              type: 'string',
              description: 'Detailed task description — what the worker should do',
            },
            assigned_worker: {
              type: 'string',
              description: 'Worker name to assign (optional — auto-assigns if empty)',
            },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high', 'critical'],
              description: 'Task priority (default: normal)',
            },
            input: {
              type: 'object',
              description: 'Task-specific input data (JSON)',
            },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              description: 'Task IDs that must complete before this task starts',
            },
          },
          required: ['title', 'description'],
        },
      },
    },
    required: ['fleet_id', 'tasks'],
  },
  category: 'Fleet',
  tags: ['fleet', 'task', 'queue', 'add'],
};

const listFleetsDef: ToolDefinition = {
  name: 'list_fleets',
  workflowUsable: true,
  description: 'List all fleets with their status, worker count, and task statistics.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  category: 'Fleet',
  tags: ['fleet', 'list', 'status'],
};

const getFleetStatusDef: ToolDefinition = {
  name: 'get_fleet_status',
  workflowUsable: true,
  description: 'Get detailed status of a fleet: session state, active workers, task queue, cost.',
  parameters: {
    type: 'object',
    properties: {
      fleet_id: { type: 'string', description: 'Fleet ID' },
    },
    required: ['fleet_id'],
  },
  category: 'Fleet',
  tags: ['fleet', 'status', 'detail'],
};

const pauseFleetDef: ToolDefinition = {
  name: 'pause_fleet',
  workflowUsable: true,
  description:
    'Pause a running fleet. Workers finish their current tasks but no new cycles start. Use resume_fleet to continue.',
  parameters: {
    type: 'object',
    properties: {
      fleet_id: { type: 'string', description: 'Fleet ID to pause' },
    },
    required: ['fleet_id'],
  },
  category: 'Fleet',
  tags: ['fleet', 'pause'],
};

const resumeFleetDef: ToolDefinition = {
  name: 'resume_fleet',
  workflowUsable: true,
  description: 'Resume a paused fleet.',
  parameters: {
    type: 'object',
    properties: {
      fleet_id: { type: 'string', description: 'Fleet ID to resume' },
    },
    required: ['fleet_id'],
  },
  category: 'Fleet',
  tags: ['fleet', 'resume'],
};

const deleteFleetDef: ToolDefinition = {
  name: 'delete_fleet',
  workflowUsable: true,
  description:
    'Delete a fleet permanently. Stops it first if running. All tasks and history are removed.',
  parameters: {
    type: 'object',
    properties: {
      fleet_id: { type: 'string', description: 'Fleet ID to delete' },
    },
    required: ['fleet_id'],
  },
  category: 'Fleet',
  tags: ['fleet', 'delete', 'remove'],
};

const broadcastToFleetDef: ToolDefinition = {
  name: 'broadcast_to_fleet',
  workflowUsable: true,
  description:
    'Send a message to all workers in a running fleet. Creates a high-priority task for each worker.',
  parameters: {
    type: 'object',
    properties: {
      fleet_id: { type: 'string', description: 'Fleet ID' },
      message: { type: 'string', description: 'Message to broadcast' },
    },
    required: ['fleet_id', 'message'],
  },
  category: 'Fleet',
  tags: ['fleet', 'broadcast', 'message'],
};

export const FLEET_TOOLS: ToolDefinition[] = [
  createFleetDef,
  startFleetDef,
  pauseFleetDef,
  resumeFleetDef,
  stopFleetDef,
  deleteFleetDef,
  addFleetTaskDef,
  listFleetsDef,
  getFleetStatusDef,
  broadcastToFleetDef,
];

// =============================================================================
// Tool Executor
// =============================================================================

export async function executeFleetTool(
  toolName: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const effectiveUserId = userId ?? 'default';

  try {
    const service = getFleetService();

    switch (toolName) {
      case 'create_fleet': {
        const name = args.name as string;
        const mission = args.mission as string;
        const workers = args.workers as Array<Record<string, unknown>>;
        const scheduleType = (args.schedule_type as string) ?? 'on-demand';
        const intervalMinutes = args.interval_minutes as number | undefined;
        const concurrencyLimit = args.concurrency_limit as number | undefined;
        const autoStart = args.auto_start !== false; // default true
        const defaultProvider = args.provider as string | undefined;
        const defaultModel = args.model as string | undefined;

        if (!name || !mission || !workers?.length) {
          return { success: false, error: 'name, mission, and workers are required' };
        }

        const workerConfigs = workers.map((w) => ({
          name: w.name as string,
          type: w.type as 'ai-chat' | 'coding-cli' | 'api-call' | 'mcp-bridge' | 'claw',
          description: w.description as string | undefined,
          provider: w.provider as string | undefined,
          model: w.model as string | undefined,
          systemPrompt: w.system_prompt as string | undefined,
          cliProvider: w.cli_provider as string | undefined,
          cwd: w.cwd as string | undefined,
          mcpServer: w.mcp_server as string | undefined,
          mcpTools: w.mcp_tools as string[] | undefined,
          allowedTools: w.allowed_tools as string[] | undefined,
        }));

        const config = await service.createFleet({
          userId: effectiveUserId,
          name,
          mission,
          workers: workerConfigs,
          scheduleType: scheduleType as 'continuous' | 'interval' | 'on-demand' | 'event' | 'cron',
          scheduleConfig: intervalMinutes ? { intervalMs: intervalMinutes * 60_000 } : undefined,
          concurrencyLimit,
          autoStart,
          provider: defaultProvider,
          model: defaultModel,
        });

        // Note: createFleet() already calls manager.startFleet() when autoStart=true,
        // so we just check the session state here (no double-start).
        const session = autoStart ? await service.getSession(config.id) : null;

        return {
          success: true,
          result: {
            fleetId: config.id,
            name: config.name,
            workers: workerConfigs.map((w) => `${w.name} (${w.type})`),
            scheduleType,
            state: session?.state ?? 'created',
            message: `Fleet "${name}" created with ${workerConfigs.length} worker(s).${autoStart ? ' Fleet is now running.' : ' Use start_fleet to begin.'} Add tasks with add_fleet_task.`,
          },
        };
      }

      case 'start_fleet': {
        const fleetId = args.fleet_id as string;
        if (!fleetId) return { success: false, error: 'fleet_id is required' };

        const session = await service.startFleet(fleetId, effectiveUserId);
        return {
          success: true,
          result: { fleetId, state: session.state, message: 'Fleet started.' },
        };
      }

      case 'stop_fleet': {
        const fleetId = args.fleet_id as string;
        if (!fleetId) return { success: false, error: 'fleet_id is required' };

        const stopped = await service.stopFleet(fleetId, effectiveUserId);
        if (!stopped) return { success: false, error: `Fleet ${fleetId} is not running` };

        return {
          success: true,
          result: { message: `Fleet ${fleetId} stopped.` },
        };
      }

      case 'pause_fleet': {
        const fleetId = args.fleet_id as string;
        if (!fleetId) return { success: false, error: 'fleet_id is required' };

        const paused = await service.pauseFleet(fleetId, effectiveUserId);
        if (!paused) return { success: false, error: `Fleet ${fleetId} is not running` };

        return {
          success: true,
          result: { message: `Fleet ${fleetId} paused. Use resume_fleet to continue.` },
        };
      }

      case 'resume_fleet': {
        const fleetId = args.fleet_id as string;
        if (!fleetId) return { success: false, error: 'fleet_id is required' };

        const resumed = await service.resumeFleet(fleetId, effectiveUserId);
        if (!resumed) return { success: false, error: `Fleet ${fleetId} is not paused` };

        return {
          success: true,
          result: { message: `Fleet ${fleetId} resumed.` },
        };
      }

      case 'delete_fleet': {
        const fleetId = args.fleet_id as string;
        if (!fleetId) return { success: false, error: 'fleet_id is required' };

        const deleted = await service.deleteFleet(fleetId, effectiveUserId);
        if (!deleted) return { success: false, error: `Fleet ${fleetId} not found` };

        return {
          success: true,
          result: { message: `Fleet ${fleetId} deleted.` },
        };
      }

      case 'add_fleet_task': {
        const fleetId = args.fleet_id as string;
        const tasks = args.tasks as Array<Record<string, unknown>>;

        if (!fleetId || !tasks?.length) {
          return { success: false, error: 'fleet_id and tasks are required' };
        }

        const taskInputs = tasks.map((t) => ({
          title: t.title as string,
          description: t.description as string,
          assignedWorker: t.assigned_worker as string | undefined,
          priority: t.priority as 'low' | 'normal' | 'high' | 'critical' | undefined,
          input: t.input as Record<string, unknown> | undefined,
          dependsOn: t.depends_on as string[] | undefined,
        }));

        const created = await service.addTasks(fleetId, effectiveUserId, taskInputs);

        return {
          success: true,
          result: {
            count: created.length,
            taskIds: created.map((t) => t.id),
            message: `Added ${created.length} task(s) to fleet ${fleetId}.`,
          },
        };
      }

      case 'list_fleets': {
        const configs = await service.listFleets(effectiveUserId);
        const fleets = await Promise.all(
          configs.map(async (config) => {
            const session = await service.getSession(config.id);
            return {
              id: config.id,
              name: config.name,
              mission: config.mission.slice(0, 100) + (config.mission.length > 100 ? '...' : ''),
              workers: config.workers.map((w) => `${w.name} (${w.type})`),
              scheduleType: config.scheduleType,
              state: session?.state ?? 'stopped',
              cyclesCompleted: session?.cyclesCompleted ?? 0,
              tasksCompleted: session?.tasksCompleted ?? 0,
              tasksFailed: session?.tasksFailed ?? 0,
              totalCostUsd: session?.totalCostUsd ?? 0,
            };
          })
        );

        return { success: true, result: { count: fleets.length, fleets } };
      }

      case 'get_fleet_status': {
        const fleetId = args.fleet_id as string;
        if (!fleetId) return { success: false, error: 'fleet_id is required' };

        const config = await service.getFleet(fleetId, effectiveUserId);
        if (!config) return { success: false, error: `Fleet ${fleetId} not found` };

        const session = await service.getSession(fleetId);
        const tasks = await service.listTasks(fleetId);

        const tasksByStatus = {
          queued: tasks.filter((t) => t.status === 'queued').length,
          running: tasks.filter((t) => t.status === 'running').length,
          completed: tasks.filter((t) => t.status === 'completed').length,
          failed: tasks.filter((t) => t.status === 'failed').length,
        };

        return {
          success: true,
          result: {
            id: config.id,
            name: config.name,
            mission: config.mission,
            workers: config.workers.map((w) => ({
              name: w.name,
              type: w.type,
              description: w.description,
            })),
            scheduleType: config.scheduleType,
            state: session?.state ?? 'stopped',
            cyclesCompleted: session?.cyclesCompleted ?? 0,
            tasksCompleted: session?.tasksCompleted ?? 0,
            tasksFailed: session?.tasksFailed ?? 0,
            totalCostUsd: session?.totalCostUsd ?? 0,
            activeWorkers: session?.activeWorkers ?? 0,
            taskQueue: tasksByStatus,
          },
        };
      }

      case 'broadcast_to_fleet': {
        const fleetId = args.fleet_id as string;
        const message = args.message as string;

        if (!fleetId || !message) {
          return { success: false, error: 'fleet_id and message are required' };
        }

        await service.broadcastToFleet(fleetId, message);
        return {
          success: true,
          result: { message: `Message broadcast to all workers in fleet ${fleetId}.` },
        };
      }

      default:
        return { success: false, error: `Unknown fleet tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}
