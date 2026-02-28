/**
 * Background Agent Tools
 *
 * AI-callable tools for spawning, listing, stopping, and messaging
 * persistent background agents. These tools are available to the main
 * chat agent so it can orchestrate background agents on behalf of the user.
 */

import type { ToolDefinition } from '@ownpilot/core';
import { getErrorMessage } from '@ownpilot/core';
import { getBackgroundAgentService } from '../services/background-agent-service.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const spawnBackgroundAgentDef: ToolDefinition = {
  name: 'spawn_background_agent',
  workflowUsable: true,
  description: `Create and start a new persistent background agent. The agent will run continuously in the background, executing its mission autonomously using available tools.

Modes:
- **continuous**: Fast cycle loop (500ms-5s between cycles). Best for time-sensitive tasks.
- **interval**: Fixed period between cycles (default 5 min). Best for periodic monitoring.
- **event**: Reactive — triggers on specific EventBus events. Best for waiting for conditions.

The agent has access to all standard tools (memory, goals, custom data, triggers, etc.) and runs independently of the chat session. Use this for long-running tasks, monitoring, automation, or any work that should happen in the background.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Short display name for the agent (e.g., "Goal Monitor", "Email Drafter")',
      },
      mission: {
        type: 'string',
        description:
          'Detailed mission description — what the agent should accomplish, step by step',
      },
      mode: {
        type: 'string',
        enum: ['continuous', 'interval', 'event'],
        description: 'Execution mode (default: interval)',
      },
      interval_minutes: {
        type: 'number',
        description: 'For interval mode: minutes between cycles (default: 5)',
      },
      allowed_tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Restrict to specific tool names (optional — if empty, all tools are available)',
      },
      stop_condition: {
        type: 'string',
        description:
          'Optional stop condition. "max_cycles:N" stops after N cycles. Agent can also stop itself by outputting "MISSION_COMPLETE".',
      },
      provider: {
        type: 'string',
        description:
          'AI provider to use (e.g., "anthropic", "openai", "google"). Optional — defaults to system model routing.',
      },
      model: {
        type: 'string',
        description:
          'AI model to use (e.g., "claude-sonnet-4-5-20250929", "gpt-4o"). Optional — defaults to system model routing.',
      },
    },
    required: ['name', 'mission'],
  },
  category: 'Background Agents',
  tags: ['agent', 'background', 'autonomous', 'spawn'],
};

const listBackgroundAgentsDef: ToolDefinition = {
  name: 'list_background_agents',
  workflowUsable: true,
  description: `List all background agents and their current status. Shows running, paused, and stopped agents with their session statistics (cycles completed, tool calls, last activity).`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  category: 'Background Agents',
  tags: ['agent', 'background', 'list', 'status'],
};

const stopBackgroundAgentDef: ToolDefinition = {
  name: 'stop_background_agent',
  workflowUsable: true,
  description: `Stop a running background agent. The agent's session state is preserved and can be viewed later. Use list_background_agents to find the agent ID.`,
  parameters: {
    type: 'object',
    properties: {
      agent_id: {
        type: 'string',
        description: 'The ID of the background agent to stop',
      },
    },
    required: ['agent_id'],
  },
  category: 'Background Agents',
  tags: ['agent', 'background', 'stop'],
};

const sendMessageToAgentDef: ToolDefinition = {
  name: 'send_message_to_agent',
  workflowUsable: true,
  description: `Send a message to a running background agent's inbox. The agent will receive and process the message during its next execution cycle. Use this to provide instructions, updates, or data to running agents.`,
  parameters: {
    type: 'object',
    properties: {
      agent_id: {
        type: 'string',
        description: 'The ID of the background agent',
      },
      message: {
        type: 'string',
        description: 'The message content to send',
      },
    },
    required: ['agent_id', 'message'],
  },
  category: 'Background Agents',
  tags: ['agent', 'background', 'message', 'communicate'],
};

export const BACKGROUND_AGENT_TOOLS: ToolDefinition[] = [
  spawnBackgroundAgentDef,
  listBackgroundAgentsDef,
  stopBackgroundAgentDef,
  sendMessageToAgentDef,
];

// =============================================================================
// Tool Executor
// =============================================================================

export async function executeBackgroundAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const effectiveUserId = userId ?? 'default';

  try {
    const service = getBackgroundAgentService();

    switch (toolName) {
      case 'spawn_background_agent': {
        const name = args.name as string;
        const mission = args.mission as string;
        const mode = (args.mode as string) ?? 'interval';
        const intervalMinutes = args.interval_minutes as number | undefined;
        const allowedTools = args.allowed_tools as string[] | undefined;
        const stopCondition = args.stop_condition as string | undefined;
        const agentProvider = args.provider as string | undefined;
        const agentModel = args.model as string | undefined;

        if (!name || !mission) {
          return { success: false, error: 'name and mission are required' };
        }

        const config = await service.createAgent({
          userId: effectiveUserId,
          name,
          mission,
          mode: mode as 'continuous' | 'interval' | 'event',
          allowedTools,
          intervalMs: intervalMinutes ? intervalMinutes * 60_000 : undefined,
          stopCondition,
          provider: agentProvider,
          model: agentModel,
          createdBy: 'ai',
          autoStart: false,
        });

        // Start the agent immediately after creation
        const session = await service.startAgent(config.id, effectiveUserId);

        return {
          success: true,
          result: {
            agentId: config.id,
            name: config.name,
            mode: config.mode,
            state: session.state,
            message: `Background agent "${name}" created and started. It will run in ${mode} mode${intervalMinutes ? ` every ${intervalMinutes} minutes` : ''}. Use list_background_agents to check its progress or stop_background_agent to stop it.`,
          },
        };
      }

      case 'list_background_agents': {
        const configs = await service.listAgents(effectiveUserId);
        const sessions = service.listSessions(effectiveUserId);

        const agents = configs.map((config) => {
          const session = sessions.find((s) => s.config.id === config.id);
          return {
            id: config.id,
            name: config.name,
            mode: config.mode,
            mission: config.mission.slice(0, 100) + (config.mission.length > 100 ? '...' : ''),
            state: session?.state ?? 'stopped',
            cyclesCompleted: session?.cyclesCompleted ?? 0,
            totalToolCalls: session?.totalToolCalls ?? 0,
            lastCycleAt: session?.lastCycleAt?.toISOString() ?? null,
            lastCycleError: session?.lastCycleError ?? null,
          };
        });

        return {
          success: true,
          result: {
            count: agents.length,
            agents,
          },
        };
      }

      case 'stop_background_agent': {
        const agentId = args.agent_id as string;
        if (!agentId) {
          return { success: false, error: 'agent_id is required' };
        }

        const stopped = await service.stopAgent(agentId, effectiveUserId);
        if (!stopped) {
          return { success: false, error: `Agent ${agentId} is not running or not found` };
        }

        return {
          success: true,
          result: { message: `Background agent ${agentId} has been stopped.` },
        };
      }

      case 'send_message_to_agent': {
        const agentId = args.agent_id as string;
        const message = args.message as string;

        if (!agentId || !message) {
          return { success: false, error: 'agent_id and message are required' };
        }

        await service.sendMessage(agentId, effectiveUserId, message);
        return {
          success: true,
          result: {
            message: `Message sent to background agent ${agentId}. It will be processed in the next cycle.`,
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
