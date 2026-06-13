/**
 * Claw Management Tools
 *
 * AI-callable tools for managing Claw agents from the main chat.
 * These tools let the chat agent create, list, start, stop, and
 * communicate with Claw agents on behalf of the user.
 */

import type { ToolDefinition } from '@ownpilot/core/agent';
import { getErrorMessage } from '@ownpilot/core/services';
import { getClawService } from '../../services/claw/service.js';

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

const pauseClawDef: ToolDefinition = {
  name: 'pause_claw',
  workflowUsable: true,
  description:
    'Pause a running Claw agent. The session state is preserved and can be resumed later with resume_claw.',
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to pause' },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'pause', 'suspend'],
};

const resumeClawDef: ToolDefinition = {
  name: 'resume_claw',
  workflowUsable: true,
  description: 'Resume a paused Claw agent. The claw will continue from where it left off.',
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to resume' },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'resume', 'continue'],
};

const updateClawDef: ToolDefinition = {
  name: 'update_claw',
  workflowUsable: true,
  description: `Update a Claw agent's configuration while it is stopped or paused.
You can change the mission, mode, interval, limits, priority, provider, model, skills, and more.
Use this to adjust a claw's behavior without deleting and recreating it.`,
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to update' },
      name: { type: 'string', description: 'New display name' },
      mission: { type: 'string', description: 'Updated mission statement (max 10,000 chars)' },
      mode: {
        type: 'string',
        enum: ['single-shot', 'continuous', 'interval', 'event'],
        description: 'Execution mode',
      },
      interval_ms: {
        type: 'number',
        description: 'Interval in milliseconds (for interval mode, e.g. 60000 = 1 min)',
      },
      stop_condition: {
        type: 'string',
        description: 'Stop condition expression (e.g., "max_cycles:100", "on_report", "idle:300")',
      },
      sandbox: {
        type: 'string',
        enum: ['auto', 'docker', 'local'],
        description: 'Script sandbox mode',
      },
      priority: {
        type: 'number',
        enum: [1, 2, 3, 4, 5],
        description: 'Scheduling priority: 1=highest (fastest), 3=normal, 5=lowest',
      },
      provider: { type: 'string', description: 'AI provider (e.g., "openai", "anthropic")' },
      model: { type: 'string', description: 'AI model (e.g., "gpt-4o", "claude-sonnet-4")' },
      coding_agent: {
        type: 'string',
        enum: ['claude-code', 'codex', 'gemini-cli'],
        description: 'Coding agent backend',
      },
      skills: {
        type: 'array',
        items: { type: 'string' },
        description: 'Skill IDs to grant (replaces existing)',
      },
      auto_start: { type: 'boolean', description: 'Auto-start when server boots' },
      limits: {
        type: 'object',
        description: 'Resource limits',
        properties: {
          max_turns_per_cycle: { type: 'number' },
          max_tool_calls_per_cycle: { type: 'number' },
          max_cycles_per_hour: { type: 'number' },
          cycle_timeout_ms: { type: 'number' },
          total_budget_usd: { type: 'number' },
        },
      },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'update', 'edit', 'configure'],
};

const deleteClawDef: ToolDefinition = {
  name: 'delete_claw',
  workflowUsable: true,
  description: `Permanently delete a Claw agent and its session data.
If the claw is running, it will be stopped first. The workspace directory is also cleaned up.
This action cannot be undone — all history, artifacts created by this claw, and workspace files will be deleted.`,
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to delete' },
      confirm: { type: 'boolean', description: 'Must be true to confirm deletion' },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'delete', 'remove', 'destroy'],
};

const getClawDoctorDef: ToolDefinition = {
  name: 'get_claw_doctor',
  workflowUsable: true,
  description: `Run diagnostic checks on a Claw agent and get recommended fixes.
Checks: interval misconfiguration, stale sessions, health status, contract score, and policy warnings.
Returns a detailed health report with auto-fixable patches and manual review items.`,
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to diagnose' },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'doctor', 'diagnose', 'health', 'fix'],
};

const applyClawFixesDef: ToolDefinition = {
  name: 'apply_claw_fixes',
  workflowUsable: true,
  description: `Apply auto-fixable patches recommended by get_claw_doctor.
This will update the claw configuration with safe defaults (interval, limits, etc.).
Only patches marked as auto-fixable are applied. Manual review items are skipped.`,
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to fix' },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'fix', 'repair', 'apply', 'doctor'],
};

const restartClawDef: ToolDefinition = {
  name: 'restart_claw',
  workflowUsable: true,
  description: `Stop and immediately restart a Claw agent. The session is reset.
Equivalent to calling stop_claw followed by start_claw in one step.
Use this when a claw is stuck or needs a fresh start without losing its configuration.`,
  parameters: {
    type: 'object',
    properties: {
      claw_id: { type: 'string', description: 'Claw ID to restart' },
    },
    required: ['claw_id'],
  },
  category: 'Claws',
  tags: ['claw', 'restart', 'reload', 'reset'],
};

// =============================================================================
// Exports
// =============================================================================

export const CLAW_MANAGEMENT_TOOLS: ToolDefinition[] = [
  createClawDef,
  listClawsDef,
  startClawDef,
  stopClawDef,
  pauseClawDef,
  resumeClawDef,
  updateClawDef,
  deleteClawDef,
  getClawStatusDef,
  getClawHistoryDef,
  getClawDoctorDef,
  applyClawFixesDef,
  restartClawDef,
  messageClawDef,
];

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

      case 'pause_claw': {
        const paused = await service.pauseClaw(args.claw_id as string, userId);
        return {
          success: paused,
          result: { message: paused ? 'Claw paused' : 'Claw not found or not running' },
        };
      }

      case 'resume_claw': {
        const resumed = await service.resumeClaw(args.claw_id as string, userId);
        return {
          success: resumed,
          result: { message: resumed ? 'Claw resumed' : 'Claw not found or not paused' },
        };
      }

      case 'restart_claw': {
        const clawId = args.claw_id as string;
        try {
          await service.stopClaw(clawId, userId);
        } catch {
          // Ignore — claw may not have been running
        }
        const session = await service.startClaw(clawId, userId);
        return {
          success: true,
          result: { state: session.state, message: `Claw restarted` },
        };
      }

      case 'update_claw': {
        const clawId = args.claw_id as string;
        const updates: Record<string, unknown> = {};
        if (args.name !== undefined) updates.name = args.name;
        if (args.mission !== undefined) updates.mission = args.mission;
        if (args.mode !== undefined) updates.mode = args.mode;
        if (args.interval_ms !== undefined) updates.intervalMs = args.interval_ms;
        if (args.stop_condition !== undefined) updates.stopCondition = args.stop_condition;
        if (args.sandbox !== undefined) updates.sandbox = args.sandbox;
        if (args.priority !== undefined) updates.priority = args.priority;
        if (args.provider !== undefined) updates.provider = args.provider;
        if (args.model !== undefined) updates.model = args.model;
        if (args.coding_agent !== undefined) updates.codingAgentProvider = args.coding_agent;
        if (args.skills !== undefined) updates.skills = args.skills;
        if (args.auto_start !== undefined) updates.autoStart = args.auto_start;
        if (args.limits !== undefined) updates.limits = args.limits;

        const updated = await service.updateClaw(clawId, userId, updates as never);
        if (!updated) return { success: false, error: 'Claw not found' };
        return {
          success: true,
          result: {
            id: updated.id,
            name: updated.name,
            mode: updated.mode,
            message: `Claw updated`,
          },
        };
      }

      case 'delete_claw': {
        const confirm = args.confirm as boolean | undefined;
        if (!confirm) {
          return {
            success: false,
            error: 'Deletion not confirmed. Pass confirm: true to proceed.',
          };
        }
        const deleted = await service.deleteClaw(args.claw_id as string, userId);
        return {
          success: deleted,
          result: { message: deleted ? 'Claw deleted' : 'Claw not found' },
        };
      }

      case 'get_claw_doctor': {
        const clawId = args.claw_id as string;
        // Fetch from the REST API like the UI does
        const res = await fetch(`/api/v1/claws/${clawId}/doctor`, {
          headers: { 'x-user-id': userId },
        });
        if (!res.ok) return { success: false, error: `Doctor check failed: ${res.statusText}` };
        const report = (await res.json()) as Record<string, unknown>;
        return { success: true, result: report };
      }

      case 'apply_claw_fixes': {
        const clawId = args.claw_id as string;
        const res = await fetch(`/api/v1/claws/${clawId}/apply-recommendations`, {
          method: 'POST',
          headers: { 'x-user-id': userId, 'content-type': 'application/json' },
        });
        if (!res.ok) return { success: false, error: `Apply fixes failed: ${res.statusText}` };
        const result = (await res.json()) as Record<string, unknown>;
        return {
          success: true,
          result: {
            message: `Applied fixes`,
            applied: result.applied,
            skipped: result.skipped,
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
