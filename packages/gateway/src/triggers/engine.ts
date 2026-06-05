/**
 * Trigger Engine
 *
 * Manages proactive trigger execution:
 * - Polls for due schedule triggers
 * - Evaluates condition triggers
 * - Handles event-based triggers
 * - Executes trigger actions
 */

import {
  type Trigger,
  type ScheduleConfig,
  type ConditionConfig,
  type EventConfig,
} from '../db/repositories/triggers.js';
import { executeTool, hasTool, waitForToolSync } from '../services/tool/executor.js';
import {
  getNextRunTime,
  getEventSystem,
  getMemoryService,
  getGoalService,
  getTriggerService,
  runInSandbox,
  createPluginId,
  type ITriggerService,
  type IGoalService,
  type IMemoryService,
  type Unsubscribe,
} from '@ownpilot/core';
import { executionPermissionsRepo } from '../db/repositories/execution-permissions.js';
import { downgradePromptToBlocked } from '../services/permission/utils.js';
import { getLog } from '../services/log.js';
import { getErrorMessage } from '../utils/common.js';
import {
  MS_PER_DAY,
  TRIGGER_POLL_INTERVAL_MS,
  TRIGGER_CONDITION_CHECK_MS,
} from '../config/defaults.js';

const log = getLog('TriggerEngine');

/** Fixed sandbox identity for pre-run gating scripts. */
const PRERUN_PLUGIN_ID = createPluginId('trigger-prerun');

/** Result of a pre-run gating script. */
interface PreRunGate {
  /** false = skip the main action (no tokens spent). Defaults to true. */
  wakeAgent: boolean;
  /** Optional text to deliver verbatim when the action is skipped. */
  output?: string;
  /** Optional context merged into the action payload when the agent wakes. */
  context?: unknown;
  /** Set when the script itself failed — treated as a trigger failure. */
  error?: string;
}

// ============================================================================
// Types
// ============================================================================

interface TriggerEngineConfig {
  pollIntervalMs?: number;
  conditionCheckIntervalMs?: number;
  enabled?: boolean;
  userId?: string;
}

interface ActionResult {
  success: boolean;
  message?: string;
  data?: unknown;
  error?: string;
}

type EventHandler = (event: TriggerEvent) => void;

interface TriggerEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

// ============================================================================
// Trigger Engine
// ============================================================================

type ChatHandler = (message: string, payload: Record<string, unknown>) => Promise<unknown>;

export class TriggerEngine {
  private config: Required<TriggerEngineConfig>;
  private triggerService: ITriggerService;
  private goalService: IGoalService;
  private memoryService: IMemoryService;
  private pollTimer: NodeJS.Timeout | null = null;
  private conditionTimer: NodeJS.Timeout | null = null;
  private running = false;
  private isProcessingSchedule = false;
  private isProcessingConditions = false;
  private executingTriggers: Set<string> = new Set();
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private actionHandlers: Map<string, (payload: Record<string, unknown>) => Promise<ActionResult>> =
    new Map();
  private chatHandler: ChatHandler | null = null;
  private eventBusUnsub: Unsubscribe | null = null;
  private processingEvents = new Set<string>();

  constructor(config: TriggerEngineConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? TRIGGER_POLL_INTERVAL_MS,
      conditionCheckIntervalMs: config.conditionCheckIntervalMs ?? TRIGGER_CONDITION_CHECK_MS,
      enabled: config.enabled ?? true,
      userId: config.userId ?? 'default',
    };

    this.triggerService = getTriggerService();
    this.goalService = getGoalService();
    this.memoryService = getMemoryService();

    // Register default action handlers
    this.registerDefaultActionHandlers();
  }

  // ==========================================================================
  // External Handler Injection
  // ==========================================================================

  /**
   * Set a handler for 'chat' actions.
   * Called during server initialization once agents are available.
   */
  setChatHandler(handler: ChatHandler): void {
    this.chatHandler = handler;
    log.info('Chat handler registered');
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the trigger engine
   */
  start(): void {
    if (this.running || !this.config.enabled) return;

    this.running = true;
    log.info('Starting...');

    // Start polling for schedule triggers
    this.pollTimer = setInterval(() => {
      try {
        this.processScheduleTriggers().catch((err) =>
          log.error('Schedule trigger poll failed', { error: err })
        );
      } catch (err) {
        log.error('Schedule trigger poll threw synchronously', { error: err });
      }
    }, this.config.pollIntervalMs);
    this.pollTimer.unref();

    // Start checking conditions
    this.conditionTimer = setInterval(() => {
      try {
        this.processConditionTriggers().catch((err) =>
          log.error('Condition trigger check failed', { error: err })
        );
      } catch (err) {
        log.error('Condition trigger check threw synchronously', { error: err });
      }
    }, this.config.conditionCheckIntervalMs);
    this.conditionTimer.unref();

    // Wait for custom tool sync then run initial checks
    waitForToolSync()
      .then(() => {
        this.processScheduleTriggers().catch((err) =>
          log.error('Initial schedule trigger poll failed', { error: err })
        );
        this.processConditionTriggers().catch((err) =>
          log.error('Initial condition trigger check failed', { error: err })
        );
      })
      .catch((err) => log.error('Tool sync wait failed', { error: err }));

    // Subscribe to ALL EventBus events for universal event-trigger processing
    try {
      const eventSystem = getEventSystem();
      this.eventBusUnsub = eventSystem.onPattern('**', (event) => {
        // Skip high-frequency internal events that no user trigger would ever listen to
        if (
          event.type.startsWith('trigger.') || // prevent infinite loops
          event.type === 'tool.registered' || // 150+ per agent creation
          event.type === 'tool.unregistered'
        ) {
          return;
        }
        this.processEventTriggers(event.type, (event.data ?? {}) as Record<string, unknown>).catch(
          (err) =>
            log.error('EventBus trigger processing failed', { error: err, eventType: event.type })
        );
      });
      log.info('Subscribed to EventBus for universal event triggers');
    } catch (err) {
      log.warn('Failed to subscribe to EventBus', { error: String(err) });
    }

    log.info('Started');
  }

  /**
   * Stop the trigger engine
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    // Unsubscribe from EventBus
    if (this.eventBusUnsub) {
      this.eventBusUnsub();
      this.eventBusUnsub = null;
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.conditionTimer) {
      clearInterval(this.conditionTimer);
      this.conditionTimer = null;
    }

    log.info('Stopped');
  }

  /**
   * Check if engine is running
   */
  isRunning(): boolean {
    return this.running;
  }

  // ==========================================================================
  // Action Handlers
  // ==========================================================================

  /**
   * Register an action handler
   */
  registerActionHandler(
    type: string,
    handler: (payload: Record<string, unknown>) => Promise<ActionResult>
  ): void {
    this.actionHandlers.set(type, handler);
  }

  /**
   * Register default action handlers
   */
  private registerDefaultActionHandlers(): void {
    // Notification action
    this.registerActionHandler('notification', async (payload) => {
      const message = payload.message as string;
      log.info('Notification', { message });
      return { success: true, message: 'Notification sent', data: { message } };
    });

    // Goal check action
    this.registerActionHandler('goal_check', async (payload) => {
      const goals = await this.goalService.getActive(this.config.userId, 5);
      const staleGoals = goals.filter((g) => {
        const daysSinceUpdate = (Date.now() - g.updatedAt.getTime()) / MS_PER_DAY;
        return daysSinceUpdate > ((payload.staleDays as number) ?? 3);
      });

      return {
        success: true,
        message: `Found ${staleGoals.length} stale goals`,
        data: { staleGoals: staleGoals.map((g) => ({ id: g.id, title: g.title })) },
      };
    });

    // Memory summary action
    this.registerActionHandler('memory_summary', async () => {
      const stats = await this.memoryService.getStats(this.config.userId);
      return {
        success: true,
        message: `Memory summary: ${stats.total} memories`,
        data: stats,
      };
    });

    // Chat action - sends a message through the AI agent system
    // The chatHandler is injected later via setChatHandler() once agents are initialized
    this.registerActionHandler('chat', async (payload) => {
      const message = (payload.prompt as string) ?? (payload.message as string);
      if (!message) {
        return { success: false, error: 'No message/prompt provided for chat action' };
      }

      // Use injected chat handler if available
      if (this.chatHandler) {
        try {
          const result = await this.chatHandler(message, payload);
          return {
            success: true,
            message: 'Chat executed',
            data: result,
          };
        } catch (error) {
          const errorMsg = getErrorMessage(error, 'Chat execution failed');
          return { success: false, error: errorMsg };
        }
      }

      // Fallback: log the message (chat handler not yet initialized)
      log.info('Chat action (no handler)', { message });
      return {
        success: true,
        message: 'Chat action logged (agent not initialized yet)',
        data: { prompt: message },
      };
    });

    // Tool action - executes a tool via the shared tool executor
    this.registerActionHandler('tool', async (payload) => {
      const toolName = payload.tool as string;
      if (!toolName) {
        return { success: false, error: 'No tool name specified' };
      }

      // Extract tool arguments (everything except internal fields)
      const { tool: _tool, triggerId: _tid, triggerName: _tn, manual: _m, ...toolArgs } = payload;

      if (!(await hasTool(toolName))) {
        return { success: false, error: `Tool '${toolName}' not found` };
      }

      // Load user's execution permissions; 'prompt' → 'blocked' for triggers (no UI for approval)
      const userPerms = await executionPermissionsRepo.get(this.config.userId);
      const triggerPerms = downgradePromptToBlocked(userPerms);

      log.info('Executing tool', { toolName });
      const result = await executeTool(toolName, toolArgs, this.config.userId, triggerPerms, {
        source: 'trigger',
        executionPermissions: triggerPerms,
      });

      return {
        success: result.success,
        message: result.success
          ? `Tool ${toolName} executed successfully`
          : `Tool ${toolName} failed`,
        data: result.result,
        error: result.error,
      };
    });

    // Workflow action - executes a workflow via the workflow service
    this.registerActionHandler('workflow', async (payload) => {
      const workflowId = payload.workflowId as string;
      if (!workflowId) {
        return { success: false, error: 'No workflowId specified' };
      }

      // Lazy import to avoid circular dependency (triggers/ → services/)
      const { getWorkflowService } = await import('../services/workflow/index.js');
      const service = getWorkflowService();

      try {
        const wfLog = await service.executeWorkflow(workflowId, this.config.userId);
        return {
          success: wfLog.status === 'completed',
          message: `Workflow ${wfLog.status} in ${wfLog.durationMs ?? 0}ms`,
          data: { logId: wfLog.id, status: wfLog.status, durationMs: wfLog.durationMs },
          error: wfLog.error ?? undefined,
        };
      } catch (error) {
        return { success: false, error: getErrorMessage(error, 'Workflow execution failed') };
      }
    });
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Subscribe to events
   */
  on(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(eventType, handlers);
  }

  /**
   * Emit an event (triggers event-based triggers)
   */
  async emit(eventType: string, payload: Record<string, unknown>): Promise<void> {
    const event: TriggerEvent = {
      type: eventType,
      payload,
      timestamp: new Date(),
    };

    // Notify local handlers
    const handlers = this.eventHandlers.get(eventType) ?? [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        log.error('Event handler error', { error });
      }
    }

    // Process event-based triggers
    await this.processEventTriggers(eventType, payload);
  }

  // ==========================================================================
  // Trigger Processing
  // ==========================================================================

  /**
   * Process due schedule triggers
   */
  private async processScheduleTriggers(): Promise<void> {
    if (this.isProcessingSchedule) return;
    this.isProcessingSchedule = true;
    try {
      const dueTriggers = await this.triggerService.getDueTriggers(this.config.userId);
      await Promise.allSettled(dueTriggers.map((t) => this.executeTrigger(t)));
    } finally {
      this.isProcessingSchedule = false;
    }
  }

  /**
   * Process event-based triggers.
   * Queries both dot-notation and legacy underscore-notation event types.
   * Circuit breaker prevents re-entrant processing of the same event type.
   */
  private async processEventTriggers(
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    // Circuit breaker: skip if we're already processing this event type
    if (this.processingEvents.has(eventType)) {
      return;
    }
    this.processingEvents.add(eventType);

    try {
      // Query triggers matching dot notation AND legacy underscore notation
      const legacyType = eventType.replace(/\./g, '_');
      const triggers = await this.triggerService.getByEventType(this.config.userId, eventType);
      if (legacyType !== eventType) {
        const legacyTriggers = await this.triggerService.getByEventType(
          this.config.userId,
          legacyType
        );
        // Deduplicate by ID
        const seen = new Set(triggers.map((t) => t.id));
        for (const t of legacyTriggers) {
          if (!seen.has(t.id)) triggers.push(t);
        }
      }

      for (const trigger of triggers) {
        const config = trigger.config as EventConfig;

        // Check filters
        if (config.filters) {
          const matches = Object.entries(config.filters).every(
            ([key, value]) => payload[key] === value
          );
          if (!matches) continue;
        }

        await this.executeTrigger(trigger, payload);
      }
    } finally {
      this.processingEvents.delete(eventType);
    }
  }

  /**
   * Process condition-based triggers
   */
  private async processConditionTriggers(): Promise<void> {
    if (this.isProcessingConditions) return;
    this.isProcessingConditions = true;
    try {
      const triggers = await this.triggerService.getConditionTriggers(this.config.userId);

      for (const trigger of triggers) {
        const config = trigger.config as ConditionConfig;

        // Respect checkInterval to avoid firing too frequently
        // Default: don't re-fire within the condition check interval
        if (trigger.lastFired) {
          const minIntervalMs = (config.checkInterval ?? 60) * 60 * 1000; // default 60 min
          const timeSinceFire = Date.now() - trigger.lastFired.getTime();
          if (timeSinceFire < minIntervalMs) continue;
        }

        const shouldFire = await this.evaluateCondition(config);

        if (shouldFire) {
          await this.executeTrigger(trigger);
        }
      }
    } finally {
      this.isProcessingConditions = false;
    }
  }

  /**
   * Evaluate a condition
   */
  private async evaluateCondition(config: ConditionConfig): Promise<boolean> {
    const threshold = config.threshold ?? 0;

    switch (config.condition) {
      case 'stale_goals': {
        // Fire if any goals haven't been updated in X days
        const goals = await this.goalService.getActive(this.config.userId, 10);
        const staleDays = threshold || 3;
        const hasStaleGoals = goals.some((g) => {
          const daysSinceUpdate = (Date.now() - g.updatedAt.getTime()) / MS_PER_DAY;
          return daysSinceUpdate > staleDays;
        });
        return hasStaleGoals;
      }

      case 'upcoming_deadline': {
        // Fire if any goals have deadlines within X days
        const upcoming = await this.goalService.getUpcoming(this.config.userId, threshold || 7);
        return upcoming.length > 0;
      }

      case 'memory_threshold': {
        // Fire if memory count exceeds threshold
        const stats = await this.memoryService.getStats(this.config.userId);
        return stats.total >= (threshold || 100);
      }

      case 'low_progress': {
        // Fire if active goals have low progress
        const goals = await this.goalService.getActive(this.config.userId, 10);
        const lowProgressGoals = goals.filter((g) => g.progress < (threshold || 20));
        return lowProgressGoals.length > 0;
      }

      case 'no_activity': {
        // Fire if no recent activity
        const stats = await this.memoryService.getStats(this.config.userId);
        return stats.recentCount === 0;
      }

      default:
        return false;
    }
  }

  /**
   * Resolve the action result for a trigger, applying job chaining and
   * zero-token pre-run gating before (optionally) running the action handler.
   * Returns `skipped: true` when the pre-run gate withheld the main action.
   */
  private async resolveActionResult(
    trigger: Trigger,
    basePayload: Record<string, unknown>
  ): Promise<{ result: ActionResult; skipped: boolean }> {
    const handler = this.actionHandlers.get(trigger.action.type);
    if (!handler) {
      return {
        result: { success: false, error: `No handler for action type: ${trigger.action.type}` },
        skipped: false,
      };
    }

    const payload: Record<string, unknown> = { ...basePayload };

    // Job chaining: inject the upstream trigger's most recent successful result.
    const contextFrom = trigger.action.contextFrom;
    if (contextFrom && contextFrom !== trigger.id) {
      const chained = await this.resolveChainedContext(contextFrom);
      if (chained !== undefined) {
        payload.chainedContext = chained;
      }
    }

    // Zero-token gating: run a cheap sandboxed script before spending tokens.
    if (trigger.action.preRun) {
      const gate = await this.runPreRun(trigger, payload);
      if (gate.error) {
        return {
          result: { success: false, error: `Pre-run script failed: ${gate.error}` },
          skipped: false,
        };
      }
      const skip = trigger.action.noAgentMode === true || gate.wakeAgent === false;
      if (skip) {
        if (gate.output) {
          await this.deliverPreRunOutput(trigger, payload, gate.output);
        }
        return {
          result: {
            success: true,
            message: trigger.action.noAgentMode
              ? 'No-agent mode: pre-run output delivered'
              : 'Skipped by pre-run gate (state unchanged)',
            data: {
              skipped: true,
              ...(gate.output !== undefined ? { output: gate.output } : {}),
            },
          },
          skipped: true,
        };
      }
      if (gate.context !== undefined) {
        payload.preRunContext = gate.context;
      }
    } else if (trigger.action.noAgentMode === true) {
      // no-agent mode without a script: nothing to run or deliver.
      return {
        result: {
          success: true,
          message: 'No-agent mode (no pre-run script)',
          data: { skipped: true },
        },
        skipped: true,
      };
    }

    const result = await handler(payload);
    return { result, skipped: false };
  }

  /**
   * Run a trigger's pre-run gating script in an isolated JS sandbox.
   * The script body may `return { wakeAgent, output?, context? }`.
   * Any failure (or no return value) defaults to waking the agent.
   */
  private async runPreRun(trigger: Trigger, payload: Record<string, unknown>): Promise<PreRunGate> {
    const preRun = trigger.action.preRun;
    if (!preRun) return { wakeAgent: true };

    try {
      const sandboxResult = await runInSandbox<unknown>(PRERUN_PLUGIN_ID, preRun.code, {
        data: {
          trigger: { id: trigger.id, name: trigger.name },
          payload,
        },
        limits: preRun.timeoutMs ? { maxExecutionTime: preRun.timeoutMs } : undefined,
      });

      if (!sandboxResult.ok) {
        return { wakeAgent: true, error: getErrorMessage(sandboxResult.error) };
      }
      const exec = sandboxResult.value;
      if (!exec.success) {
        return { wakeAgent: true, error: exec.error ?? 'pre-run execution failed' };
      }

      const ret = exec.value;
      // Safe default: a script that returns nothing wakes the agent.
      if (ret === null || ret === undefined || typeof ret !== 'object') {
        return { wakeAgent: true };
      }
      const obj = ret as Record<string, unknown>;
      return {
        wakeAgent: obj.wakeAgent !== false,
        output: typeof obj.output === 'string' ? obj.output : undefined,
        context: 'context' in obj ? obj.context : undefined,
      };
    } catch (error) {
      return { wakeAgent: true, error: getErrorMessage(error) };
    }
  }

  /**
   * Fetch the most recent successful result of an upstream trigger, for
   * job chaining via `action.contextFrom`.
   */
  private async resolveChainedContext(upstreamTriggerId: string): Promise<unknown> {
    try {
      const { history } = await this.triggerService.getHistoryForTrigger(
        this.config.userId,
        upstreamTriggerId,
        { status: 'success', limit: 1 }
      );
      return history[0]?.result ?? undefined;
    } catch (error) {
      log.warn('Failed to resolve chained context', {
        upstreamTriggerId,
        error: getErrorMessage(error),
      });
      return undefined;
    }
  }

  /**
   * Deliver pre-run output verbatim to a channel when the trigger payload
   * specifies `channel` + `chat_id`. Otherwise the output stays in history.
   */
  private async deliverPreRunOutput(
    trigger: Trigger,
    payload: Record<string, unknown>,
    output: string
  ): Promise<void> {
    const channel = (payload.channel ?? payload.channelId) as string | undefined;
    const chatId = (payload.chat_id ?? payload.chatId) as string | undefined;
    if (!channel || !chatId) {
      log.info('Pre-run output not delivered (no channel/chat_id in payload)', {
        trigger: trigger.name,
      });
      return;
    }
    if (!(await hasTool('send_channel_message'))) return;

    const userPerms = await executionPermissionsRepo.get(this.config.userId);
    const triggerPerms = downgradePromptToBlocked(userPerms);
    await executeTool(
      'send_channel_message',
      { channel, chat_id: chatId, text: output },
      this.config.userId,
      triggerPerms,
      { source: 'trigger', executionPermissions: triggerPerms }
    );
  }

  /**
   * Execute a trigger
   */
  private async executeTrigger(
    trigger: Trigger,
    eventPayload?: Record<string, unknown>
  ): Promise<void> {
    // Prevent overlapping execution of the same trigger
    if (this.executingTriggers.has(trigger.id)) return;
    this.executingTriggers.add(trigger.id);

    const startTime = Date.now();

    try {
      // Merge event payload with action payload
      const basePayload = {
        ...trigger.action.payload,
        ...(eventPayload ?? {}),
        triggerId: trigger.id,
        triggerName: trigger.name,
      };

      // Resolve chaining + pre-run gating, then run the action (or skip it)
      const { result, skipped } = await this.resolveActionResult(trigger, basePayload);
      const durationMs = Date.now() - startTime;

      // Log execution — 'skipped' when the pre-run gate withheld the action
      await this.triggerService.logExecution(
        this.config.userId,
        trigger.id,
        trigger.name,
        skipped ? 'skipped' : result.success ? 'success' : 'failure',
        result.data,
        result.error,
        durationMs
      );

      getEventSystem().emit(
        result.success ? 'trigger.success' : 'trigger.failed',
        'trigger-engine',
        result.success
          ? {
              triggerId: trigger.id,
              triggerName: trigger.name,
              durationMs,
              actionType: trigger.action.type,
              result: result.data,
            }
          : {
              triggerId: trigger.id,
              triggerName: trigger.name,
              durationMs,
              actionType: trigger.action.type,
              error: result.error ?? 'Unknown error',
            }
      );

      // Advance a schedule trigger to its next fire time (mark non-schedule fired)
      if (trigger.type === 'schedule') {
        await this.advanceSchedule(trigger);
      } else {
        await this.triggerService.markFired(this.config.userId, trigger.id);
      }

      log.info('Executed trigger', { trigger: trigger.name, durationMs });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      // Log failure
      await this.triggerService.logExecution(
        this.config.userId,
        trigger.id,
        trigger.name,
        'failure',
        undefined,
        errorMessage,
        durationMs
      );
      getEventSystem().emit('trigger.failed', 'trigger-engine', {
        triggerId: trigger.id,
        triggerName: trigger.name,
        durationMs,
        actionType: trigger.action.type,
        error: errorMessage,
      });
      log.error('Trigger failed', { trigger: trigger.name, error });

      // Advance the trigger's schedule/lastFired even on unexpected failure,
      // mirroring the success path. Otherwise a persistently-failing trigger
      // re-fires forever: a schedule trigger stays "due" and fires every poll;
      // a condition trigger never sets lastFired, so its checkInterval throttle
      // never engages and it re-fires every condition tick — both re-hammer the
      // failing action (e.g. a channel send to a blocked chat). Wrap in its own
      // try so a reschedule failure can't mask the original error.
      try {
        if (trigger.type === 'schedule') {
          await this.advanceSchedule(trigger);
        } else {
          await this.triggerService.markFired(this.config.userId, trigger.id);
        }
      } catch (rescheduleError) {
        log.error('Failed to reschedule trigger after failure', {
          trigger: trigger.name,
          error: getErrorMessage(rescheduleError),
        });
      }
    } finally {
      this.executingTriggers.delete(trigger.id);
    }
  }

  /**
   * Advance a schedule trigger to its next cron fire time (persisted via
   * markFired). No-op for non-schedule triggers. Extracted so it runs on BOTH
   * the success and failure paths of executeTrigger — a throwing schedule
   * trigger must still reschedule, or it hot-loops every poll.
   */
  private async advanceSchedule(trigger: Trigger): Promise<void> {
    if (trigger.type !== 'schedule') return;
    const config = trigger.config as ScheduleConfig;
    const nextFire = this.calculateNextFire(config);
    await this.triggerService.markFired(this.config.userId, trigger.id, nextFire ?? undefined);
    if (nextFire) {
      log.info('Next fire scheduled', { trigger: trigger.name, nextFire });
    } else {
      log.warn('Trigger has no next fire time — will not auto-fire again', {
        trigger: trigger.name,
      });
    }
  }

  /**
   * Calculate next fire time from cron expression using core's production parser.
   */
  private calculateNextFire(config: ScheduleConfig): string | null {
    if (!config.cron) {
      log.warn('calculateNextFire called with empty cron');
      return null;
    }
    try {
      const nextRun = getNextRunTime(config.cron);
      if (!nextRun) {
        log.warn('No next fire time for cron — trigger will not reschedule', { cron: config.cron });
      }
      return nextRun ? nextRun.toISOString() : null;
    } catch (error) {
      log.error('Failed to parse cron', { cron: config.cron, error });
      return null;
    }
  }

  // ==========================================================================
  // Manual Trigger Execution
  // ==========================================================================

  /**
   * Manually fire a trigger
   */
  async fireTrigger(triggerId: string): Promise<ActionResult> {
    const trigger = await this.triggerService.getTrigger(this.config.userId, triggerId);
    if (!trigger) {
      return { success: false, error: 'Trigger not found' };
    }
    if (!trigger.enabled) {
      return { success: false, error: 'Trigger is disabled' };
    }

    const startTime = Date.now();

    try {
      const { result, skipped } = await this.resolveActionResult(trigger, {
        ...trigger.action.payload,
        triggerId: trigger.id,
        triggerName: trigger.name,
        manual: true,
      });

      const durationMs = Date.now() - startTime;

      await this.triggerService.logExecution(
        this.config.userId,
        trigger.id,
        trigger.name,
        skipped ? 'skipped' : result.success ? 'success' : 'failure',
        result.data,
        result.error,
        durationMs
      );

      getEventSystem().emit(
        result.success ? 'trigger.success' : 'trigger.failed',
        'trigger-engine',
        result.success
          ? {
              triggerId: trigger.id,
              triggerName: trigger.name,
              durationMs,
              actionType: trigger.action.type,
              result: result.data,
            }
          : {
              triggerId: trigger.id,
              triggerName: trigger.name,
              durationMs,
              actionType: trigger.action.type,
              error: result.error ?? 'Unknown error',
            }
      );

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      await this.triggerService.logExecution(
        this.config.userId,
        trigger.id,
        trigger.name,
        'failure',
        undefined,
        errorMessage,
        durationMs
      );
      getEventSystem().emit('trigger.failed', 'trigger-engine', {
        triggerId: trigger.id,
        triggerName: trigger.name,
        durationMs,
        actionType: trigger.action.type,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let engineInstance: TriggerEngine | null = null;

/**
 * Get or create the trigger engine instance
 */
export function getTriggerEngine(config?: TriggerEngineConfig): TriggerEngine {
  if (!engineInstance) {
    engineInstance = new TriggerEngine(config);
  }
  return engineInstance;
}

/**
 * Start the trigger engine
 */
export function startTriggerEngine(config?: TriggerEngineConfig): TriggerEngine {
  const engine = getTriggerEngine(config);
  engine.start();
  return engine;
}

/**
 * Stop the trigger engine
 */
export function stopTriggerEngine(): void {
  if (engineInstance) {
    engineInstance.stop();
  }
}
