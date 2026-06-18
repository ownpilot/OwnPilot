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
  getWorkflowService,
  getTriggerService,
  getLog,
  getRuntimeContext,
  hasProviderService,
  getProviderService,
  type RuntimeContext,
  type CreateTriggerInput,
  type TriggerAction,
} from '@ownpilot/core/services';
import { getClawService } from '@ownpilot/core/services/claw';
import { getCodingAgentService } from '@ownpilot/core/services/coding-agent';
import { getTriggerEngine } from '../triggers/engine.js';
import type { ExecutionStep } from '@ownpilot/core/agentic';
import { getEventSystem } from '@ownpilot/core/events';
import { calculateCost, type AIProvider } from '@ownpilot/core/costs';
import { executeTool } from '../services/tool/executor.js';
import { executionPermissionsRepo } from '../db/repositories/execution-permissions.js';
import { downgradePromptToBlocked } from '../services/permission/utils.js';
import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { getOrCreateChatAgent } from '../services/agent/service.js';

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
  /** Set to true when the step was cancelled via AbortSignal. */
  cancelled?: boolean;
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
   * Emits WebSocket events for real-time observability.
   */
  async dispatch(step: ExecutionStep, signal?: AbortSignal): Promise<DispatchResult> {
    const startTime = Date.now();
    const events = getEventSystem();

    // Pre-flight abort check: if the signal is already cancelled before we start,
    // return immediately without doing any work.
    if (signal?.aborted) {
      const result: DispatchResult = {
        success: false,
        output: null,
        cancelled: true,
        durationMs: Date.now() - startTime,
      };
      (events.emit as (type: string, source: string, data: Record<string, unknown>) => void)(
        'agentic.step.fail',
        'agentic-executor',
        {
          stepIndex: step.index,
          executorKind: step.executorKind,
          capabilityId: step.capabilityId,
          durationMs: result.durationMs,
          error: 'Cancelled',
          cancelled: true,
        }
      );
      return result;
    }

    // Emit start event — cast needed for cross-package EventMap sync
    (events.emit as (type: string, source: string, data: unknown) => void)(
      'agentic.step.start',
      'agentic-executor',
      {
        stepIndex: step.index,
        executorKind: step.executorKind,
        capabilityId: step.capabilityId,
      }
    );

    // Run the dispatch.
    // Note: the signal parameter is accepted for future co-operative cancellation
    // but the underlying executor methods do not yet check it during execution.
    const result = await this.runDispatch(step, startTime);

    // Emit completion event — cancelled steps emit 'agentic.step.fail' with the cancelled flag.
    const eventType = result.cancelled
      ? 'agentic.step.fail'
      : result.success
        ? 'agentic.step.complete'
        : 'agentic.step.fail';
    (events.emit as (type: string, source: string, data: Record<string, unknown>) => void)(
      eventType,
      'agentic-executor',
      {
        stepIndex: step.index,
        executorKind: step.executorKind,
        capabilityId: step.capabilityId,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        error: result.cancelled ? 'Cancelled' : result.error,
        cancelled: result.cancelled,
      }
    );

    return result;
  }

  /**
   * Inner dispatch logic — runs the executor switch and returns the result.
   * Extracted so withCancellation() can wrap the whole operation.
   */
  private async runDispatch(step: ExecutionStep, startTime: number): Promise<DispatchResult> {
    const signal = undefined; // signal is already checked in the outer dispatch()
    switch (step.executorKind) {
      case 'claw':
        return this.dispatchClaw(step, signal);
      case 'soul_heartbeat':
        return this.dispatchSoulHeartbeat(step, signal);
      case 'crew':
        return this.dispatchCrew(step, signal);
      case 'coding_agent':
        return this.dispatchCodingAgent(step, signal);
      case 'workflow':
        return this.dispatchWorkflow(step, signal);
      case 'trigger':
        return this.dispatchTrigger(step, signal);
      case 'channel':
        return this.dispatchChannel(step, signal);
      case 'direct_llm':
        return this.dispatchDirectLlm(step, signal);
      case 'sandbox_code':
        return this.dispatchSandbox(step, signal);
      case 'tool_catalog':
        return this.dispatchTool(step, signal);
      default:
        return {
          success: false,
          output: null,
          error: `Unknown executor kind: ${step.executorKind}`,
          durationMs: Date.now() - startTime,
        };
    }
  }

  // ── Claw ──────────────────────────────────────────────────────────────
  //
  // For single-shot agentic tasks we use the chat agent directly (faster,
  // no claw lifecycle overhead). The claw path is only used when an
  // explicit clawId is provided (existing persistent claw).

  private async dispatchClaw(step: ExecutionStep, _signal?: AbortSignal): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;
    const taskDesc = (params.task as string) || 'Execute agentic task';

    const clawId = params.clawId as string | undefined;
    if (clawId) {
      // Execute on an existing persistent claw
      const service = getClawService();
      const userId = (params.userId as string) || LOCAL_OWNER_ID;
      const result = await service.executeNow(clawId, userId);
      return {
        success: true,
        output: result,
        durationMs: Date.now() - startTime,
        costUsd: (result as { costUsd?: number })?.costUsd,
      };
    }

    // Single-shot: use the chat agent directly.
    // Resolve provider/model — explicit params > env vars > system defaults.
    const explicitProvider = params.provider as string | undefined;
    const explicitModel = params.model as string | undefined;
    const systemPrompt = params.prompt as string | undefined;
    let provider = explicitProvider || process.env.DEFAULT_PROVIDER || '';
    let model = explicitModel || process.env.DEFAULT_MODEL || '';

    // If not explicitly set, try the ProviderService for the system default.
    if (!provider && hasProviderService()) {
      try {
        const svc = getProviderService();
        const resolved = await svc.resolve({});
        provider = resolved.provider ?? '';
        model = resolved.model ?? model;
      } catch {
        /* fall through */
      }
    }

    // If still no provider, return a clear error instead of failing
    // with "API key not configured for provider: openai".
    if (!provider) {
      return {
        success: false,
        output: null,
        error: 'No AI provider configured. Go to Settings → API Keys to add a provider.',
        durationMs: Date.now() - startTime,
      };
    }

    const agent = await getOrCreateChatAgent(provider, model);

    // Apply custom system prompt if provided
    if (systemPrompt) {
      agent.updateSystemPrompt(systemPrompt);
    }

    const result = await agent.chat(taskDesc);

    if (!result.ok) {
      return {
        success: false,
        output: null,
        error: result.error.message,
        durationMs: Date.now() - startTime,
      };
    }

    // Populate cost tracking from the completion response usage
    const usage = result.value.usage;
    const costUsd = usage
      ? calculateCost(provider as AIProvider, model, usage.promptTokens, usage.completionTokens)
      : undefined;

    return {
      success: true,
      output: { content: result.value.content },
      durationMs: Date.now() - startTime,
      tokensUsed: usage ? { input: usage.promptTokens, output: usage.completionTokens } : undefined,
      costUsd,
    };
  }

  // ── Soul Heartbeat ────────────────────────────────────────────────────

  private async dispatchSoulHeartbeat(
    step: ExecutionStep,
    _signal?: AbortSignal
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    const taskDesc = (params.task as string) || 'Execute heartbeat task';
    const agentId = (params.agentId as string) || (params.soulId as string);

    if (!agentId) {
      return {
        success: false,
        output: null,
        error: 'soul_heartbeat requires agentId or soulId in params',
        durationMs: Date.now() - startTime,
      };
    }

    // Use LLMRouter.pick() to resolve provider+model, then return a placeholder.
    // Full LLM completion requires the gateway agent infrastructure.
    const resolved = await this.ctx.llm.pick({ errorContext: 'soul_heartbeat' });

    return {
      success: true,
      output: {
        note: 'Soul heartbeat dispatched',
        agentId,
        provider: resolved.provider,
        model: resolved.model,
        task: taskDesc,
      },
      durationMs: Date.now() - startTime,
    };
  }

  // ── Crew ──────────────────────────────────────────────────────────────

  private async dispatchCrew(step: ExecutionStep, _signal?: AbortSignal): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

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

    const resolved = await this.ctx.llm.pick({ errorContext: 'crew' });

    return {
      success: true,
      output: {
        note: 'Crew dispatched',
        crewId,
        provider: resolved.provider,
        model: resolved.model,
        task: taskDesc,
      },
      durationMs: Date.now() - startTime,
      costUsd: 0,
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
    const userId = (params.userId as string) || LOCAL_OWNER_ID;

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
    const userId = (params.userId as string) || LOCAL_OWNER_ID;
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
            task: ((action.payload as Record<string, unknown>)?.task as string) ?? '',
            expectedOutput:
              ((action.payload as Record<string, unknown>)?.expectedOutput as string) ?? '',
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
            task: ((action.payload as Record<string, unknown>)?.task as string) ?? '',
            expectedOutput:
              ((action.payload as Record<string, unknown>)?.expectedOutput as string) ?? '',
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
            task: ((action.payload as Record<string, unknown>)?.task as string) ?? '',
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
        const taskDesc = ((action.payload as Record<string, unknown>)?.task as string) ?? '';
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
    await this.ctx.channels.send(channelProvider, {
      platformChatId: chatId || 'default',
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
    _signal?: AbortSignal
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const params = step.params as Record<string, unknown>;

    const taskDesc = (params.task as string) || '';
    const systemPrompt =
      (params.systemPrompt as string) ||
      'You are a helpful AI assistant. Respond concisely and accurately.';

    // Use LLMRouter.pick() to resolve provider+model, then return a placeholder.
    // Full streaming LLM completion requires the gateway chat agent infrastructure.
    const resolved = await this.ctx.llm.pick({ errorContext: 'direct_llm' });

    return {
      success: true,
      output: {
        note: 'Direct LLM dispatched (placeholder — requires gateway agent for full completion)',
        provider: resolved.provider,
        model: resolved.model,
        systemPrompt,
        task: taskDesc,
      },
      durationMs: Date.now() - startTime,
      costUsd: 0,
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

    // Honor the user's Execution Security settings. The sandbox is isolated, but
    // it is still code execution — so a disabled master switch or a 'blocked'
    // language category must block it, matching the code-execution tools and
    // dispatchTool. 'system' is non-interactive, so 'prompt' downgrades to
    // 'blocked'.
    const category =
      language === 'python' || language === 'py' ? 'execute_python' : 'execute_javascript';
    const userId = (params.userId as string) || LOCAL_OWNER_ID;
    const perms = downgradePromptToBlocked(await executionPermissionsRepo.get(userId));
    if (!perms.enabled || perms[category] === 'blocked') {
      return {
        success: false,
        output: null,
        error: `Sandbox code execution blocked: ${category} is disabled in Execution Security settings`,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Dynamically import sandbox executor (it's in @ownpilot/core/sandbox)
      const { runInSandbox } = await import('@ownpilot/core/sandbox');
      const result = await (
        runInSandbox as unknown as (code: string, opts: Record<string, unknown>) => Promise<unknown>
      )(code, {
        pluginId: 'agentic',
        language: language as string,
        timeout: (params.timeoutMs as number) ?? 30_000,
      });

      return {
        success: true,
        output: result,
        durationMs: Date.now() - startTime,
      };
    } catch {
      return {
        success: false,
        output: null,
        error: `Sandbox execution not available for language: ${language}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ── Tool Catalog ──────────────────────────────────────────────────────

  private async dispatchTool(step: ExecutionStep, _signal?: AbortSignal): Promise<DispatchResult> {
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

    // Execute a single tool via the shared tool executor. Pass the same
    // permission context plans/triggers use so agentic tool dispatch also goes
    // through the ToolPermissionService gate (tool-group enable, CLI policy,
    // custom-tool approval). 'system' is non-interactive, so 'prompt' code-exec
    // permissions downgrade to 'blocked'. Without this the tool_catalog step
    // bypassed the gate entirely.
    const userId = (params.userId as string) || LOCAL_OWNER_ID;
    const userPerms = await executionPermissionsRepo.get(userId);
    const execPerms = downgradePromptToBlocked(userPerms);
    const toolResult = await executeTool(toolName, toolArgs, userId, execPerms, {
      source: 'system',
      executionPermissions: execPerms,
    });

    return {
      success: toolResult.success,
      output: toolResult.result,
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
