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
  TriggersRepository,
  type Trigger,
  type TriggerAction,
  type ScheduleConfig,
  type ConditionConfig,
  type EventConfig,
} from '../db/repositories/triggers.js';
import { GoalsRepository } from '../db/repositories/goals.js';
import { MemoriesRepository } from '../db/repositories/memories.js';
import { executeTool, hasTool } from '../services/tool-executor.js';
import { getNextRunTime, matchesCron } from '@ownpilot/core';

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
  private repo: TriggersRepository;
  private goalsRepo: GoalsRepository;
  private memoriesRepo: MemoriesRepository;
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

    this.repo = new TriggersRepository(this.config.userId);
    this.goalsRepo = new GoalsRepository(this.config.userId);
    this.memoriesRepo = new MemoriesRepository(this.config.userId);

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
    console.log('[TriggerEngine] Chat handler registered');
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
    console.log('[TriggerEngine] Starting...');

    // Start polling for schedule triggers
    this.pollTimer = setInterval(() => {
      this.processScheduleTriggers().catch(console.error);
    }, this.config.pollIntervalMs);

    // Start checking conditions
    this.conditionTimer = setInterval(() => {
      this.processConditionTriggers().catch(console.error);
    }, this.config.conditionCheckIntervalMs);

    // Run initial checks
    this.processScheduleTriggers().catch(console.error);
    this.processConditionTriggers().catch(console.error);

    console.log('[TriggerEngine] Started');
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

    console.log('[TriggerEngine] Stopped');
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
      console.log(`[TriggerEngine] Notification: ${message}`);
      return { success: true, message: 'Notification sent', data: { message } };
    });

    // Goal check action
    this.registerActionHandler('goal_check', async (payload) => {
      const goals = await this.goalsRepo.getActive(5);
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
      const stats = await this.memoriesRepo.getStats();
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
      console.log(`[TriggerEngine] Chat action (no handler): ${message}`);
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

      console.log(`[TriggerEngine] Executing tool: ${toolName}`);
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
        console.error(`[TriggerEngine] Event handler error:`, error);
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
    const dueTriggers = await this.repo.getDueTriggers();

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
    const triggers = await this.repo.getByEventType(eventType);

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
    const triggers = await this.repo.getConditionTriggers();

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
        const goals = await this.goalsRepo.getActive(10);
        const staleDays = threshold || 3;
        const hasStaleGoals = goals.some((g) => {
          const daysSinceUpdate = (Date.now() - g.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
          return daysSinceUpdate > staleDays;
        });
        return hasStaleGoals;
      }

      case 'upcoming_deadline': {
        // Fire if any goals have deadlines within X days
        const upcoming = await this.goalsRepo.getUpcoming(threshold || 7);
        return upcoming.length > 0;
      }

      case 'memory_threshold': {
        // Fire if memory count exceeds threshold
        const stats = await this.memoriesRepo.getStats();
        return stats.total >= (threshold || 100);
      }

      case 'low_progress': {
        // Fire if active goals have low progress
        const goals = await this.goalsRepo.getActive(10);
        const lowProgressGoals = goals.filter((g) => g.progress < (threshold || 20));
        return lowProgressGoals.length > 0;
      }

      case 'no_activity': {
        // Fire if no recent activity
        const stats = await this.memoriesRepo.getStats();
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
      await this.repo.logExecution(
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
        await this.repo.markFired(trigger.id, nextFire ?? undefined);
        if (nextFire) {
          console.log(`[TriggerEngine] Next fire for "${trigger.name}": ${nextFire}`);
        } else {
          console.warn(`[TriggerEngine] WARNING: Trigger "${trigger.name}" has no next fire time — will not auto-fire again`);
        }
      } else {
        await this.repo.markFired(trigger.id);
      }

      console.log(`[TriggerEngine] Executed trigger: ${trigger.name} (${durationMs}ms)`);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Log failure
      await this.repo.logExecution(trigger.id, 'failure', undefined, errorMessage, durationMs);
      console.error(`[TriggerEngine] Trigger failed: ${trigger.name}`, error);
    }
  }

  /**
   * Calculate next fire time from cron expression using core's production parser.
   */
  private calculateNextFire(config: ScheduleConfig): string | null {
    if (!config.cron) {
      console.warn('[TriggerEngine] calculateNextFire called with empty cron');
      return null;
    }
    try {
      const nextRun = getNextRunTime(config.cron);
      if (!nextRun) {
        console.warn(`[TriggerEngine] No next fire time for cron "${config.cron}" — trigger will not reschedule`);
      }
      return nextRun ? nextRun.toISOString() : null;
    } catch (error) {
      console.error(`[TriggerEngine] Failed to parse cron "${config.cron}":`, error);
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
    const trigger = await this.repo.get(triggerId);
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

      await this.repo.logExecution(
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

      await this.repo.logExecution(trigger.id, 'failure', undefined, errorMessage, durationMs);
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
