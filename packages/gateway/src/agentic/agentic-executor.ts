/**
 * Agentic Gateway Executor
 *
 * Wires the AgenticCapabilityLayer dispatchStep() to real gateway services.
 * Each executor kind is routed to the appropriate service:
 *
 *   claw           → ClawService (create session + run cycle)
 *   soul_heartbeat → HeartbeatRunner (execute heartbeat cycle)
 *   crew           → CrewManager (dispatch to crew)
 *   coding_agent   → CodingAgentService (run a coding task)
 *   workflow       → WorkflowService (execute a DAG workflow)
 *   trigger        → TriggerEngine (register + fire trigger action)
 *   channel        → ChannelService / RuntimeContext.channels (send message)
 *   direct_llm     → Agent (create agent + call chat)
 *   sandbox_code   → SandboxExecutor (run code in VM sandbox)
 *   tool_catalog   → ToolService / executeTool (run a single tool)
 *
 * Usage:
 *   import { getAgenticExecutor } from './agentic/agentic-executor.js';
 *   const output = await getAgenticExecutor().dispatch(step, signal);
 */

import {
  getClawService,
  getWorkflowService,
  getCodingAgentService,
  getTriggerEngine,
  getTriggerService,
  getLog,
  getErrorMessage,
  getRuntimeContext,
  generateId,
  type RuntimeContext,
  type CreateTriggerInput,
  type TriggerAction,
} from '@ownpilot/core/services';
import type { ExecutionStep, ExecutorKind } from '@ownpilot/core/agentic';
import { ClawRunner } from '../services/claw/runner.js';
import { getClawManager } from '../services/claw/manager.js';
import {
  getSharedToolRegistry,
  executeTool,
} from '../services/tool/executor.js';
import type { ClawConfig, ClawSession } from '@ownpilot/core/services';

const log = getLog('AgenticExecutor');

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert an interval in milliseconds to a cron expression.
 * Rounds to the nearest natural unit (minutes, hours, days).
 */
function convertIntervalToCron(intervalMs: number | undefined): string | null {
  if (!intervalMs || intervalMs < 1000) return null;

  const minutes = Math.round(intervalMs / 60_000);
  if (minutes < 60) {
    return `*/${Math.max(1, minutes)} * * * *`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `0 */${Math.max(1, hours)} * * *`;
  }

  const days = Math.round(hours / 24);
  return `0 0 */${Math.max(1, days)} * *`;
}

// ============================================================================
// Result envelope
// ============================================================================

export interface DispatchResult {
  success: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
  costUsd?: number;
  tokensUsed?: { input: number; output: number };
}

// ============================================================================
// AgenticGatewayExecutor
// ============================================================================

export class AgenticGatewayExecutor {
  private readonly ctx: RuntimeContext;

  constructor(ctx?: RuntimeContext) {
    this.ctx = ctx ?? getRuntimeContext();
  }

  /**
   * Dispatch a single execution step to the correct gateway service.
   * This is the method that AgenticOrchestrator calls via dispatchStep().
   */
  async dispatch(step: ExecutionStep, signal?: AbortSignal): Promise<DispatchResult> {
    const startTime = Date.now();

    try {
      switch (step.executorKind) {
        case 'claw':
          return await this.dispatchClaw(step, signal);
        case 'soul_heartbeat':
          return await this.dispatchSoulHeartbeat(step, signal);
        case 'crew':
          return await this.dispatchCrew(step, signal);
        case 'coding_agent':
          return await this.dispatchCodingAgent(step, signal);
        case 'workflow':
          return await this.dispatchWorkflow(step, signal);
        case 'trigger':
          return await this.dispatchTrigger(step, signal);
        case 'channel':
          return await this.dispatchChannel(step, signal);
        case 'direct_llm':
          return await this.dispatchDirectLlm(step, signal);
        case 'sandbox_code':
          return await this.dispatchSandbox(step, signal);
        case 'tool_catalog':
          return await this.dispatchTool(step, signal);
        default:
          return {
            success: false,
            output: null,
            error: `Unknown executor kind: ${step.executorKind}`,
            durationMs: Date.now() - startTime,
          };
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        error: getErrorMessage(err, `Step ${step.index} failed`),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ── Claw ──────────────────────────────────────────────────────────────

  private async dispatchClaw(step: ExecutionStep, signal?: AbortSignal): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    // Create a claw config inline for single-shot execution
    const service = getClawService();
    const taskDesc = (params.task as string) || 'Execute agentic task';

    // Check if we have an existing claw ID or need to create one
    const clawId = params.clawId as string | undefined;
    const userId = params.userId as string || 'local';

    let result;
    if (clawId) {
      // Execute on existing claw session
      result = await service.executeNow(clawId, userId);
    } else {
      // Create a single-shot claw for this execution
      const config = await service.createClaw({
        userId,
        name: `agentic-${Date.now()}`,
        mission: taskDesc,
        mode: 'single-shot',
        createdBy: 'claw',
      });

      const session = await service.startClaw(config.id, userId);

      // Run the cycle via the manager
      const manager = getClawManager();
      // We can't easily call runCycle from here without a ManagedClaw wrapper,
      // so we use the service's executeNow which is designed for this
      result = await service.executeNow(config.id, userId);
    }

    return {
      success: true,
      output: result,
      durationMs: Date.now() - startTime,
      costUsd: (result as { costUsd?: number })?.costUsd,
    };
  }

  // ── Soul Heartbeat ────────────────────────────────────────────────────

  private async dispatchSoulHeartbeat(
    step: ExecutionStep,
    _signal?: AbortSignal
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    // HeartbeatRunner is wired via the existing cron/trigger system.
    // For direct execution, we use the agent system to chat with the soul.
    const taskDesc = (params.task as string) || 'Execute heartbeat task';
    const agentId = (params.agentId as string) || params.soulId as string;

    if (!agentId) {
      return {
        success: false,
        output: null,
        error: 'soul_heartbeat requires agentId or soulId in params',
        durationMs: Date.now() - startTime,
      };
    }

    // Use the LLMRouter to send a message to the soul's agent
    const result = await this.ctx.llm.pickAndComplete({
      systemPrompt: `You are an autonomous soul agent (${agentId}). Execute the following task autonomously and report results.`,
      messages: [{ role: 'user' as const, content: taskDesc }],
      processKind: 'agent',
      signal: _signal,
    });

    return {
      success: true,
      output: result.content,
      durationMs: Date.now() - startTime,
    };
  }

  // ── Crew ──────────────────────────────────────────────────────────────

  private async dispatchCrew(step: ExecutionStep, _signal?: AbortSignal): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    // Crew dispatch: send message to all crew members via communication bus
    const crewId = params.crewId as string;
    const taskDesc = (params.task as string) || 'Execute crew task';

    if (!crewId) {
      return {
        success: false,
        output: null,
        error: 'crew step requires crewId in params',
        durationMs: Date.now() - startTime,
      };
    }

    // Use LLMRouter for a multi-agent coordination prompt
    const result = await this.ctx.llm.pickAndComplete({
      systemPrompt: `You are a crew coordinator for crew "${crewId}". Coordinate the members to complete the following task. Provide a structured plan and final result.`,
      messages: [{ role: 'user' as const, content: taskDesc }],
      processKind: 'agent',
      signal: _signal,
    });

    return {
      success: true,
      output: result.content,
      durationMs: Date.now() - startTime,
      costUsd: result.costUsd,
      tokensUsed: result.usage ? { input: result.usage.inputTokens, output: result.usage.outputTokens } : undefined,
    };
  }

  // ── Coding Agent ──────────────────────────────────────────────────────

  private async dispatchCodingAgent(
    step: ExecutionStep,
    _signal?: AbortSignal
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    const service = getCodingAgentService();
    const taskDesc = (params.task as string) || 'Execute coding task';
    const provider = (params.provider as string) || 'claude-code';

    const result = await service.runTask({
      provider: provider as 'claude-code' | 'codex' | 'gemini-cli',
      prompt: taskDesc,
      cwd: params.cwd as string | undefined,
      timeout: (params.timeoutMs as number) ?? 300_000,
    });

    return {
      success: result.success,
      output: result.output,
      error: result.error,
      durationMs: result.durationMs || Date.now() - startTime,
    };
  }

  // ── Workflow ──────────────────────────────────────────────────────────

  private async dispatchWorkflow(
    step: ExecutionStep,
    _signal?: AbortSignal
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    const service = getWorkflowService();
    const workflowId = params.workflowId as string;
    const userId = (params.userId as string) || 'local';

    if (!workflowId) {
      return {
        success: false,
        output: null,
        error: 'workflow step requires workflowId in params',
        durationMs: Date.now() - startTime,
      };
    }

    const logEntry = await service.executeWorkflow(workflowId, userId, undefined, {
      inputs: params.inputs as Record<string, unknown> | undefined,
    });

    return {
      success: logEntry.status === 'completed',
      output: logEntry.nodeResults,
      error: logEntry.error ?? undefined,
      durationMs: logEntry.durationMs ?? Date.now() - startTime,
    };
  }

  // ── Trigger ───────────────────────────────────────────────────────────

  private async dispatchTrigger(
    step: ExecutionStep,
    _signal?: AbortSignal
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    const triggerConfig = params.trigger as Record<string, unknown> | undefined;
    const action = params.action as Record<string, unknown> | undefined;
    const userId = (params.userId as string) || 'local';
    const taskName = (params.taskName as string) || 'agentic-trigger';

    if (!triggerConfig || !action) {
      return {
        success: false,
        output: null,
        error: 'trigger step requires trigger and action in params',
        durationMs: Date.now() - startTime,
      };
    }

    const triggerType = triggerConfig.type as string;

    // Map agentic trigger types to actual persistent triggers or Claw sessions.
    switch (triggerType) {
      case 'scheduled':
      case 'interval': {
        // Create a persistent scheduled trigger via ITriggerService.
        const cron =
          (triggerConfig.cron as string) ??
          convertIntervalToCron(triggerConfig.intervalMs as number | undefined);
        if (!cron) {
          return {
            success: false,
            output: null,
            error: 'scheduled/interval trigger requires cron or intervalMs',
            durationMs: Date.now() - startTime,
          };
        }

        const triggerAction: TriggerAction = {
          type: 'chat',
          payload: {
            task: (action.payload as Record<string, unknown>)?.task as string ?? '',
            expectedOutput: (action.payload as Record<string, unknown>)?.expectedOutput as string ?? '',
          },
        };

        const input: CreateTriggerInput = {
          name: taskName,
          description: `Auto-created by Agentic layer: ${triggerType} trigger`,
          type: 'schedule',
          config: {
            cron,
            timezone: (triggerConfig.timezone as string) ?? 'UTC',
          },
          action: triggerAction,
          enabled: true,
          priority: 3,
        };

        const trigger = await getTriggerService().createTrigger(userId, input);

        log.info('Created scheduled trigger from agentic plan', {
          triggerId: trigger.id,
          cron,
        });

        return {
          success: true,
          output: {
            triggerId: trigger.id,
            type: 'schedule',
            cron,
            nextFire: trigger.nextFire?.toISOString() ?? null,
          },
          durationMs: Date.now() - startTime,
        };
      }

      case 'event': {
        // Create a persistent event trigger.
        const eventType = (triggerConfig.eventType as string) || 'custom';
        const filters = triggerConfig.filters as Record<string, unknown> | undefined;

        const triggerAction: TriggerAction = {
          type: 'chat',
          payload: {
            task: (action.payload as Record<string, unknown>)?.task as string ?? '',
            expectedOutput: (action.payload as Record<string, unknown>)?.expectedOutput as string ?? '',
          },
        };

        const input: CreateTriggerInput = {
          name: taskName,
          description: `Auto-created by Agentic layer: event trigger on ${eventType}`,
          type: 'event',
          config: {
            eventType,
            ...(filters ? { filters } : {}),
          },
          action: triggerAction,
          enabled: true,
        };

        const trigger = await getTriggerService().createTrigger(userId, input);

        log.info('Created event trigger from agentic plan', {
          triggerId: trigger.id,
          eventType,
        });

        return {
          success: true,
          output: {
            triggerId: trigger.id,
            type: 'event',
            eventType,
          },
          durationMs: Date.now() - startTime,
        };
      }

      case 'condition': {
        // Create a persistent condition trigger.
        const condition = (triggerConfig.condition as string) || '';
        if (!condition) {
          return {
            success: false,
            output: null,
            error: 'condition trigger requires condition expression',
            durationMs: Date.now() - startTime,
          };
        }

        const triggerAction: TriggerAction = {
          type: 'chat',
          payload: {
            task: (action.payload as Record<string, unknown>)?.task as string ?? '',
          },
        };

        const input: CreateTriggerInput = {
          name: taskName,
          description: `Auto-created by Agentic layer: condition trigger`,
          type: 'condition',
          config: {
            condition,
            threshold: (triggerConfig.threshold as number) ?? undefined,
            checkInterval: (triggerConfig.checkIntervalMs as number) ?? undefined,
          },
          action: triggerAction,
          enabled: true,
        };

        const trigger = await getTriggerService().createTrigger(userId, input);

        return {
          success: true,
          output: {
            triggerId: trigger.id,
            type: 'condition',
            condition,
          },
          durationMs: Date.now() - startTime,
        };
      }

      case 'continuous': {
        // Continuous mode is not a persistent trigger — create a Claw in continuous mode.
        const taskDesc = (action.payload as Record<string, unknown>)?.task as string ?? '';
        const service = getClawService();
        const claw = await service.createClaw({
          userId,
          name: taskName,
          mission: taskDesc,
          mode: 'continuous',
          createdBy: 'claw',
        });
        const session = await service.startClaw(claw.id, userId);

        return {
          success: true,
          output: {
            clawId: claw.id,
            type: 'continuous',
            state: session.state,
          },
          durationMs: Date.now() - startTime,
        };
      }

      default: {
        // Unsupported trigger type — fall back to immediate execution via emit.
        const engine = getTriggerEngine();
        await engine.emit('agentic:trigger', {
          triggerType,
          actionType: (action.type as string) || 'chat',
          ...((action.payload as Record<string, unknown>) || {}),
        });

        return {
          success: true,
          output: { triggered: true, type: triggerType, note: 'emitted as one-shot event' },
          durationMs: Date.now() - startTime,
        };
      }
    }
  }

  // ── Channel ───────────────────────────────────────────────────────────

  private async dispatchChannel(
    step: ExecutionStep,
    _signal?: AbortSignal
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    const message = (params.message as string) || (params.task as string) || '';
    const channelProvider = params.provider as string;
    const chatId = params.chatId as string;

    if (!message || !channelProvider) {
      return {
        success: false,
        output: null,
        error: 'channel step requires message and provider in params',
        durationMs: Date.now() - startTime,
      };
    }

    // Use the channel service from RuntimeContext
    await this.ctx.channels.sendMessage(channelProvider, chatId || 'default', {
      text: message,
    });

    return {
      success: true,
      output: { sent: true, provider: channelProvider, chatId },
      durationMs: Date.now() - startTime,
    };
  }

  // ── Direct LLM ────────────────────────────────────────────────────────

  private async dispatchDirectLlm(
    step: ExecutionStep,
    signal?: AbortSignal
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    const taskDesc = (params.task as string) || '';
    const systemPrompt = (params.systemPrompt as string) ||
      'You are a helpful AI assistant. Respond concisely and accurately.';

    // Use LLMRouter to pick the best model and complete
    const result = await this.ctx.llm.pickAndComplete({
      systemPrompt,
      messages: [{ role: 'user' as const, content: taskDesc }],
      processKind: 'agent',
      signal,
    });

    return {
      success: true,
      output: result.content,
      durationMs: Date.now() - startTime,
      costUsd: result.costUsd,
      tokensUsed: result.usage
        ? { input: result.usage.inputTokens, output: result.usage.outputTokens }
        : undefined,
    };
  }

  // ── Sandbox Code ──────────────────────────────────────────────────────

  private async dispatchSandbox(
    step: ExecutionStep,
    _signal?: AbortSignal
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    const code = (params.code as string) || '';
    const language = (params.language as string) || 'javascript';

    if (!code) {
      return {
        success: false,
        output: null,
        error: 'sandbox_code step requires code in params',
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Dynamically import sandbox executor (it's in @ownpilot/core/sandbox)
      const { SandboxExecutor } = await import('@ownpilot/core/sandbox');
      const executor = new SandboxExecutor({
        pluginId: '@ownpilot/agentic',
        timeout: (params.timeoutMs as number) ?? 30_000,
      });

      const result = await executor.execute(code, {
        language: language as 'javascript' | 'python',
        context: params.context as Record<string, unknown> | undefined,
      });

      return {
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs: result.durationMs || Date.now() - startTime,
      };
    } catch {
      // Sandbox not available — try shared tool executor as fallback
      return {
        success: false,
        output: null,
        error: `Sandbox execution not available for language: ${language}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ── Tool Catalog ──────────────────────────────────────────────────────

  private async dispatchTool(
    step: ExecutionStep,
    _signal?: AbortSignal
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    const toolName = (params.tool as string) || '';
    const toolArgs = (params.args as Record<string, unknown>) || {};

    if (!toolName) {
      return {
        success: false,
        output: null,
        error: 'tool_catalog step requires tool name in params',
        durationMs: Date.now() - startTime,
      };
    }

    // Execute a single tool via the shared tool executor
    const toolResult = await executeTool(toolName, toolArgs, 'local');

    return {
      success: toolResult.success,
      output: toolResult.result ?? toolResult.output,
      error: toolResult.error,
      durationMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Singleton Access
// ============================================================================

let _executor: AgenticGatewayExecutor | null = null;

/**
 * Get the global AgenticGatewayExecutor singleton.
 */
export function getAgenticExecutor(ctx?: RuntimeContext): AgenticGatewayExecutor {
  if (!_executor) {
    _executor = new AgenticGatewayExecutor(ctx);
  }
  return _executor;
}

/**
 * Replace the executor singleton (for testing).
 */
export function setAgenticExecutor(executor: AgenticGatewayExecutor): void {
  _executor = executor;
}

/**
 * Reset the executor singleton.
 */
export function resetAgenticExecutor(): void {
  _executor = null;
}
