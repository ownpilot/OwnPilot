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
import { getTriggerService, type TriggerService } from '../services/trigger-service.js';
import { getGoalService, type GoalService } from '../services/goal-service.js';
import { getMemoryService, type MemoryService } from '../services/memory-service.js';
import { executeTool, hasTool } from '../services/tool-executor.js';
import { getNextRunTime } from '@ownpilot/core';
import { getLog } from '../services/log.js';

const log = getLog('TriggerEngine');

// ============================================================================
// Types
// ============================================================================

export interface TriggerEngineConfig {
  pollIntervalMs?: number;
  conditionCheckIntervalMs?: number;
  enabled?: boolean;
  userId?: string;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: unknown;
  error?: string;
}

export type EventHandler = (event: TriggerEvent) => void;

export interface TriggerEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

// ============================================================================
// Trigger Engine
// ============================================================================

export type ChatHandler = (message: string, payload: Record<string, unknown>) => Promise<unknown>;

export class TriggerEngine {
  private config: Required<TriggerEngineConfig>;
  private triggerService: TriggerService;
  private goalService: GoalService;
  private memoryService: MemoryService;
  private pollTimer: NodeJS.Timeout | null = null;
  private conditionTimer: NodeJS.Timeout | null = null;
  private running = false;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private actionHandlers: Map<string, (payload: Record<string, unknown>) => Promise<ActionResult>> = new Map();
  private chatHandler: ChatHandler | null = null;

  constructor(config: TriggerEngineConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60000, // 1 minute
      conditionCheckIntervalMs: config.conditionCheckIntervalMs ?? 300000, // 5 minutes
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
      this.processScheduleTriggers().catch((err) => log.error('Schedule trigger poll failed', { error: err }));
    }, this.config.pollIntervalMs);

    // Start checking conditions
    this.conditionTimer = setInterval(() => {
      this.processConditionTriggers().catch((err) => log.error('Condition trigger check failed', { error: err }));
    }, this.config.conditionCheckIntervalMs);

    // Run initial checks
    this.processScheduleTriggers().catch((err) => log.error('Initial schedule trigger poll failed', { error: err }));
    this.processConditionTriggers().catch((err) => log.error('Initial condition trigger check failed', { error: err }));

    log.info('Started');
  }

  /**
   * Stop the trigger engine
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

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
      const goals = await this.goalService.getActive(this.config.userId,5);
      const staleGoals = goals.filter((g) => {
        const daysSinceUpdate = (Date.now() - g.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceUpdate > (payload.staleDays as number ?? 3);
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
      const message = payload.prompt as string ?? payload.message as string;
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
          const errorMsg = error instanceof Error ? error.message : 'Chat execution failed';
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

      if (!await hasTool(toolName)) {
        return { success: false, error: `Tool '${toolName}' not found` };
      }

      log.info('Executing tool', { toolName });
      const result = await executeTool(toolName, toolArgs, this.config.userId);

      return {
        success: result.success,
        message: result.success ? `Tool ${toolName} executed successfully` : `Tool ${toolName} failed`,
        data: result.result,
        error: result.error,
      };
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
    const dueTriggers = await this.triggerService.getDueTriggers(this.config.userId);

    for (const trigger of dueTriggers) {
      await this.executeTrigger(trigger);
    }
  }

  /**
   * Process event-based triggers
   */
  private async processEventTriggers(
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const triggers = await this.triggerService.getByEventType(this.config.userId, eventType);

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
  }

  /**
   * Process condition-based triggers
   */
  private async processConditionTriggers(): Promise<void> {
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
  }

  /**
   * Evaluate a condition
   */
  private async evaluateCondition(config: ConditionConfig): Promise<boolean> {
    const threshold = config.threshold ?? 0;

    switch (config.condition) {
      case 'stale_goals': {
        // Fire if any goals haven't been updated in X days
        const goals = await this.goalService.getActive(this.config.userId,10);
        const staleDays = threshold || 3;
        const hasStaleGoals = goals.some((g) => {
          const daysSinceUpdate = (Date.now() - g.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
          return daysSinceUpdate > staleDays;
        });
        return hasStaleGoals;
      }

      case 'upcoming_deadline': {
        // Fire if any goals have deadlines within X days
        const upcoming = await this.goalService.getUpcoming(this.config.userId,threshold || 7);
        return upcoming.length > 0;
      }

      case 'memory_threshold': {
        // Fire if memory count exceeds threshold
        const stats = await this.memoryService.getStats(this.config.userId);
        return stats.total >= (threshold || 100);
      }

      case 'low_progress': {
        // Fire if active goals have low progress
        const goals = await this.goalService.getActive(this.config.userId,10);
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
   * Execute a trigger
   */
  private async executeTrigger(
    trigger: Trigger,
    eventPayload?: Record<string, unknown>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Get action handler
      const handler = this.actionHandlers.get(trigger.action.type);
      if (!handler) {
        throw new Error(`No handler for action type: ${trigger.action.type}`);
      }

      // Merge event payload with action payload
      const payload = {
        ...trigger.action.payload,
        ...(eventPayload ?? {}),
        triggerId: trigger.id,
        triggerName: trigger.name,
      };

      // Execute action
      const result = await handler(payload);
      const durationMs = Date.now() - startTime;

      // Log success
      await this.triggerService.logExecution(
        this.config.userId,
        trigger.id,
        result.success ? 'success' : 'failure',
        result.data,
        result.error,
        durationMs
      );

      // Calculate next fire time for schedule triggers
      if (trigger.type === 'schedule') {
        const config = trigger.config as ScheduleConfig;
        const nextFire = this.calculateNextFire(config);
        await this.triggerService.markFired(this.config.userId, trigger.id, nextFire ?? undefined);
        if (nextFire) {
          log.info('Next fire scheduled', { trigger: trigger.name, nextFire });
        } else {
          log.warn('Trigger has no next fire time — will not auto-fire again', { trigger: trigger.name });
        }
      } else {
        await this.triggerService.markFired(this.config.userId, trigger.id);
      }

      log.info('Executed trigger', { trigger: trigger.name, durationMs });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Log failure
      await this.triggerService.logExecution(this.config.userId, trigger.id, 'failure', undefined, errorMessage, durationMs);
      log.error('Trigger failed', { trigger: trigger.name, error });
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

    const startTime = Date.now();

    try {
      const handler = this.actionHandlers.get(trigger.action.type);
      if (!handler) {
        return { success: false, error: `No handler for action type: ${trigger.action.type}` };
      }

      const result = await handler({
        ...trigger.action.payload,
        triggerId: trigger.id,
        triggerName: trigger.name,
        manual: true,
      });

      const durationMs = Date.now() - startTime;

      await this.triggerService.logExecution(
        this.config.userId,
        trigger.id,
        result.success ? 'success' : 'failure',
        result.data,
        result.error,
        durationMs
      );

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.triggerService.logExecution(this.config.userId, trigger.id, 'failure', undefined, errorMessage, durationMs);
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
