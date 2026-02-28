/**
 * Autonomy Engine
 *
 * The "heart and soul" — an AI-driven engine that proactively decides
 * what to do without user prompting. Runs on an adaptive timer (5-15 min),
 * gathers rich context, creates a real Agent with tools, and lets the agent
 * act freely — using tools like send_user_notification, memory, weather, etc.
 *
 * Follows the TriggerEngine singleton lifecycle pattern.
 */

import { generateId, getServiceRegistry, getEventSystem, Services, getErrorMessage } from '@ownpilot/core';
import type {
  IPulseService,
  PulseResult,
  PulseActionResult,
  PulseStats,
  AutonomyLogEntry,
} from '@ownpilot/core';
import { gatherPulseContext, type PulseContext } from './context.js';
import {
  evaluatePulseContext,
  calculateNextInterval,
  DEFAULT_RULE_THRESHOLDS,
  type RuleThresholds,
} from './evaluator.js';
import type { Signal } from './evaluator.js';
import { DEFAULT_ACTION_COOLDOWNS, type ActionCooldowns } from './executor.js';
import { getPulseSystemPrompt, buildPulseUserMessage } from './prompt.js';
import { reportPulseResult } from './reporter.js';
import { createAutonomyLogRepo } from '../db/repositories/autonomy-log.js';
import { settingsRepo } from '../db/repositories/settings.js';
import {
  PULSE_MIN_INTERVAL_MS,
  PULSE_MAX_INTERVAL_MS,
  PULSE_QUIET_HOURS_START,
  PULSE_QUIET_HOURS_END,
  PULSE_MAX_ACTIONS,
  PULSE_LOG_RETENTION_DAYS,
} from '../config/defaults.js';
import { getLog } from '../services/log.js';

const log = getLog('AutonomyEngine');

// ============================================================================
// Pulse Directives
// ============================================================================

export interface PulseDirectives {
  disabledRules: string[];
  blockedActions: string[];
  customInstructions: string;
  template: string;
  ruleThresholds: RuleThresholds;
  actionCooldowns: ActionCooldowns;
}

export const DEFAULT_PULSE_DIRECTIVES: PulseDirectives = {
  disabledRules: [],
  blockedActions: [],
  customInstructions: '',
  template: 'balanced',
  ruleThresholds: DEFAULT_RULE_THRESHOLDS,
  actionCooldowns: DEFAULT_ACTION_COOLDOWNS,
};

// ============================================================================
// Configuration
// ============================================================================

export interface AutonomyEngineConfig {
  userId: string;
  enabled?: boolean;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  maxActions?: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
}

// ============================================================================
// Engine
// ============================================================================

export class AutonomyEngine implements IPulseService {
  private config: Required<AutonomyEngineConfig>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private activePulse: { pulseId: string; stage: string; startedAt: number } | null = null;
  private lastPulseResult?: PulseResult;

  constructor(config: AutonomyEngineConfig) {
    this.config = {
      userId: config.userId,
      enabled: config.enabled ?? true,
      minIntervalMs: config.minIntervalMs ?? PULSE_MIN_INTERVAL_MS,
      maxIntervalMs: config.maxIntervalMs ?? PULSE_MAX_INTERVAL_MS,
      maxActions: config.maxActions ?? PULSE_MAX_ACTIONS,
      quietHoursStart: config.quietHoursStart ?? PULSE_QUIET_HOURS_START,
      quietHoursEnd: config.quietHoursEnd ?? PULSE_QUIET_HOURS_END,
    };
  }

  // ============================================================================
  // IPulseService implementation
  // ============================================================================

  start(): void {
    if (this.running) return;
    if (!this.config.enabled) {
      log.info('Autonomy Engine is disabled.');
      return;
    }
    this.running = true;
    log.info('Autonomy Engine started.', {
      interval: `${this.config.minIntervalMs / 60_000}-${this.config.maxIntervalMs / 60_000} min`,
      quietHours: `${this.config.quietHoursStart}:00-${this.config.quietHoursEnd}:00`,
    });
    this.scheduleNext(this.config.maxIntervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    log.info('Autonomy Engine stopped.');
  }

  isRunning(): boolean {
    return this.running;
  }

  async runPulse(userId: string, manual = false): Promise<PulseResult> {
    const pulseId = generateId('pulse');
    const startTime = Date.now();

    // Execution lock — prevent concurrent pulses
    if (this.activePulse) {
      return {
        pulseId,
        userId,
        pulsedAt: new Date(),
        durationMs: 0,
        signalsFound: 0,
        llmCalled: false,
        actionsExecuted: [],
        reportMessage: '',
        urgencyScore: 0,
        error: 'Pulse already in progress',
        manual,
      };
    }

    this.activePulse = { pulseId, stage: 'starting', startedAt: startTime };
    this.broadcastActivity('started', 'starting');

    try {
      // Load user directives
      const directives = this.getDirectives();

      // 1. Gather rich context
      this.setStage('gathering');
      const ctx = await gatherPulseContext(userId);

      // 2. Evaluate signals (skip disabled rules, apply thresholds)
      this.setStage('evaluating');
      const evaluation = evaluatePulseContext(
        ctx,
        directives.disabledRules,
        directives.ruleThresholds
      );

      // Compute cooldown status for the agent prompt
      const lastActionTimes = this.getLastActionTimes();
      const cooledDownActions: Array<{ type: string; remainingMinutes: number }> = [];
      for (const [actionType, cooldownMin] of Object.entries(directives.actionCooldowns)) {
        if (cooldownMin <= 0) continue;
        const lastTime = lastActionTimes[actionType];
        if (lastTime) {
          const elapsed = (Date.now() - new Date(lastTime).getTime()) / 60_000;
          if (elapsed < cooldownMin) {
            cooledDownActions.push({
              type: actionType,
              remainingMinutes: Math.ceil(cooldownMin - elapsed),
            });
          }
        }
      }

      // 3. Run agent pulse — real agent with tools
      this.setStage('deciding');
      const agentResult = await this.runAgentPulse(
        userId,
        ctx,
        evaluation.signals,
        directives,
        cooledDownActions
      );

      // 4. Map agent's tool calls to PulseActionResult[] for logging
      const actionResults: PulseActionResult[] = agentResult.toolCalls.map((tc) => ({
        type: tc.name ?? 'agent_action',
        success: true,
        output: { arguments: tc.arguments },
      }));

      // If agent didn't use any tools, log a skip
      if (actionResults.length === 0) {
        actionResults.push({ type: 'skip', success: true, skipped: true });
      }

      // Update last action times for tool calls
      const updatedActionTimes = { ...lastActionTimes };
      for (const tc of agentResult.toolCalls) {
        if (tc.name) {
          updatedActionTimes[tc.name] = new Date().toISOString();
        }
      }
      await this.saveLastActionTimes(updatedActionTimes);

      // 5. Build result
      const result: PulseResult = {
        pulseId,
        userId,
        pulsedAt: new Date(),
        durationMs: Date.now() - startTime,
        signalsFound: evaluation.signals.length,
        llmCalled: true,
        actionsExecuted: actionResults,
        reportMessage: agentResult.responseContent,
        urgencyScore: evaluation.urgencyScore,
        manual,
        signalIds: evaluation.signals.map((s) => s.id),
      };

      // 6. Report (via EventBus)
      this.setStage('reporting');
      await reportPulseResult(result);

      // 7. Log to DB
      await this.logResult(result);

      this.lastPulseResult = result;

      this.broadcastActivity('completed', 'done', {
        signalsFound: result.signalsFound,
        actionsExecuted: result.actionsExecuted.length,
        durationMs: result.durationMs,
      });

      // Adjust interval based on urgency
      if (this.running && !manual) {
        const nextMs = calculateNextInterval(
          evaluation.urgencyScore,
          this.config.minIntervalMs,
          this.config.maxIntervalMs
        );
        this.scheduleNext(nextMs);
      }

      return result;
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      this.broadcastActivity('error', 'error', { error: errorMsg });

      const result: PulseResult = {
        pulseId,
        userId,
        pulsedAt: new Date(),
        durationMs: Date.now() - startTime,
        signalsFound: 0,
        llmCalled: false,
        actionsExecuted: [],
        reportMessage: '',
        urgencyScore: 0,
        error: errorMsg,
        manual,
      };

      await this.logResult(result);
      this.lastPulseResult = result;

      if (this.running && !manual) {
        this.scheduleNext(this.config.maxIntervalMs);
      }

      return result;
    } finally {
      this.activePulse = null;
    }
  }

  async getRecentLogs(userId: string, limit = 20): Promise<AutonomyLogEntry[]> {
    const repo = createAutonomyLogRepo(userId);
    return repo.getRecent(limit);
  }

  async getRecentLogsPaginated(userId: string, limit = 20, offset = 0) {
    const repo = createAutonomyLogRepo(userId);
    return repo.getPage(limit, offset);
  }

  async getStats(userId: string): Promise<PulseStats> {
    const repo = createAutonomyLogRepo(userId);
    return repo.getStats();
  }

  // ============================================================================
  // EventBus emission helpers
  // ============================================================================

  private broadcastActivity(
    status: 'started' | 'stage' | 'completed' | 'error',
    stage: string,
    extra?: Record<string, unknown>
  ): void {
    try {
      const eventSystem = getEventSystem();
      const pulseId = this.activePulse?.pulseId ?? 'unknown';
      if (status === 'started') {
        eventSystem.emit('pulse.started', 'autonomy-engine', {
          pulseId,
          userId: this.config.userId,
        });
      } else if (status === 'stage') {
        eventSystem.emit('pulse.stage', 'autonomy-engine', {
          pulseId,
          stage: stage as 'gathering' | 'evaluating' | 'deciding' | 'reporting',
        });
      } else if (status === 'completed') {
        eventSystem.emit('pulse.completed', 'autonomy-engine', {
          pulseId,
          userId: this.config.userId,
          durationMs: (extra?.durationMs as number) ?? 0,
          signalsFound: (extra?.signalsFound as number) ?? 0,
          actionsExecuted: (extra?.actionsExecuted as number) ?? 0,
          llmCalled: true,
        });
      }
      // 'error' status doesn't have a dedicated event type — logged by caller
    } catch {
      // EventSystem may not be initialized during tests
    }
  }

  private setStage(stage: string): void {
    if (this.activePulse) {
      this.activePulse.stage = stage;
      this.broadcastActivity('stage', stage);
    }
  }

  updateSettings(settings: Partial<AutonomyEngineConfig>): void {
    if (settings.enabled !== undefined) this.config.enabled = settings.enabled;
    if (settings.minIntervalMs !== undefined) this.config.minIntervalMs = settings.minIntervalMs;
    if (settings.maxIntervalMs !== undefined) this.config.maxIntervalMs = settings.maxIntervalMs;
    if (settings.maxActions !== undefined) this.config.maxActions = settings.maxActions;
    if (settings.quietHoursStart !== undefined)
      this.config.quietHoursStart = settings.quietHoursStart;
    if (settings.quietHoursEnd !== undefined) this.config.quietHoursEnd = settings.quietHoursEnd;

    if (!settings.enabled && this.running) {
      this.stop();
    } else if (settings.enabled && !this.running) {
      this.start();
    }
  }

  getStatus(): {
    running: boolean;
    enabled: boolean;
    config: Required<AutonomyEngineConfig>;
    activePulse: { pulseId: string; stage: string; startedAt: number } | null;
    lastPulse?: { pulsedAt: Date; signalsFound: number; urgencyScore: number };
  } {
    return {
      running: this.running,
      enabled: this.config.enabled,
      config: { ...this.config },
      activePulse: this.activePulse ? { ...this.activePulse } : null,
      lastPulse: this.lastPulseResult
        ? {
            pulsedAt: this.lastPulseResult.pulsedAt,
            signalsFound: this.lastPulseResult.signalsFound,
            urgencyScore: this.lastPulseResult.urgencyScore,
          }
        : undefined,
    };
  }

  // ============================================================================
  // Agent-based Pulse Execution
  // ============================================================================

  private async runAgentPulse(
    userId: string,
    ctx: PulseContext,
    signals: Signal[],
    directives: PulseDirectives,
    cooledDownActions: Array<{ type: string; remainingMinutes: number }>
  ): Promise<{ responseContent: string; toolCalls: Array<{ name?: string; arguments?: string }> }> {
    try {
      const { getOrCreateChatAgent } = await import('../routes/agent-service.js');
      const { resolveForProcess } = await import('../services/model-routing.js');
      const resolved = await resolveForProcess('pulse');
      const provider = resolved.provider ?? 'openai';
      const model = resolved.model ?? 'gpt-4o-mini';
      const fallback =
        resolved.fallbackProvider && resolved.fallbackModel
          ? { provider: resolved.fallbackProvider, model: resolved.fallbackModel }
          : undefined;

      // Get or create a chat agent with full tool access
      const agent = await getOrCreateChatAgent(provider, model, fallback);

      // Create a fresh conversation for this pulse cycle
      const memory = agent.getMemory();
      const systemPrompt = getPulseSystemPrompt(ctx, directives.customInstructions);
      const conversation = memory.create(systemPrompt);
      agent.loadConversation(conversation.id);

      // Build context message
      const userMessage = buildPulseUserMessage(
        ctx,
        signals,
        directives.blockedActions,
        cooledDownActions
      );

      // Run agent — it uses tools freely (send_user_notification, memory, weather, etc.)
      const result = await agent.chat(userMessage);

      // Clean up the pulse conversation to avoid accumulating context
      memory.delete(conversation.id);

      if (result.ok) {
        return {
          responseContent: result.value.content ?? '',
          toolCalls: (result.value.toolCalls ?? []).map((tc) => ({
            name: tc.name,
            arguments: tc.arguments,
          })),
        };
      }

      log.warn('Agent pulse returned error result', { error: result.error.message });
      return { responseContent: '', toolCalls: [] };
    } catch (error) {
      log.warn('Agent pulse failed', { error: String(error) });
      return { responseContent: `Agent pulse failed: ${getErrorMessage(error)}`, toolCalls: [] };
    }
  }

  // ============================================================================
  // Internal
  // ============================================================================

  private getDirectives(): PulseDirectives {
    const stored = settingsRepo.get<Partial<PulseDirectives>>('pulse.directives');
    if (!stored) return DEFAULT_PULSE_DIRECTIVES;
    return {
      ...DEFAULT_PULSE_DIRECTIVES,
      ...stored,
      ruleThresholds: { ...DEFAULT_RULE_THRESHOLDS, ...stored.ruleThresholds },
      actionCooldowns: { ...DEFAULT_ACTION_COOLDOWNS, ...stored.actionCooldowns },
    };
  }

  private getLastActionTimes(): Record<string, string> {
    return settingsRepo.get<Record<string, string>>('pulse.lastActionTimes') ?? {};
  }

  private async saveLastActionTimes(times: Record<string, string>): Promise<void> {
    await settingsRepo.set('pulse.lastActionTimes', times);
  }

  private scheduleNext(delayMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.tick(), delayMs);
    this.timer.unref(); // Don't block process exit
  }

  private async tick(): Promise<void> {
    if (!this.running || this.activePulse) return;

    // Quiet hours check
    const hour = new Date().getHours();
    if (this.isQuietHours(hour)) {
      log.debug('Quiet hours, skipping pulse.');
      this.scheduleNext(this.config.maxIntervalMs);
      return;
    }

    try {
      await this.runPulse(this.config.userId);
    } catch (error) {
      log.warn('Pulse cycle failed', { error: String(error) });
      if (this.running) {
        this.scheduleNext(this.config.maxIntervalMs);
      }
    }
  }

  private isQuietHours(hour: number): boolean {
    const start = this.config.quietHoursStart;
    const end = this.config.quietHoursEnd;

    if (start <= end) {
      // e.g. 9-17
      return hour >= start && hour < end;
    }
    // Wraps around midnight (e.g. 22-7)
    return hour >= start || hour < end;
  }

  private async logResult(result: PulseResult): Promise<void> {
    try {
      const repo = createAutonomyLogRepo(result.userId);
      await repo.insert({
        userId: result.userId,
        pulsedAt: result.pulsedAt,
        durationMs: result.durationMs,
        signalsFound: result.signalsFound,
        llmCalled: result.llmCalled,
        actionsCount: result.actionsExecuted.length,
        actions: result.actionsExecuted,
        reportMsg: result.reportMessage || null,
        error: result.error ?? null,
        manual: result.manual,
        signalIds: result.signalIds ?? [],
        urgencyScore: result.urgencyScore ?? 0,
      });

      // Periodic cleanup
      if (Math.random() < 0.05) {
        await repo.cleanup(PULSE_LOG_RETENTION_DAYS);
      }
    } catch (error) {
      log.debug('Failed to log pulse result', { error: String(error) });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let engineInstance: AutonomyEngine | null = null;

/**
 * Get or create the singleton AutonomyEngine instance.
 */
export function getAutonomyEngine(config?: AutonomyEngineConfig): AutonomyEngine {
  if (!engineInstance) {
    engineInstance = new AutonomyEngine(config ?? { userId: 'default' });
  }
  return engineInstance;
}

/**
 * Create an IPulseService adapter from the engine instance.
 * This is registered in the ServiceRegistry at boot.
 */
export function createPulseServiceAdapter(engine: AutonomyEngine): IPulseService {
  return {
    start: () => engine.start(),
    stop: () => engine.stop(),
    isRunning: () => engine.isRunning(),
    runPulse: (userId, manual) => engine.runPulse(userId, manual),
    getRecentLogs: (userId, limit) => engine.getRecentLogs(userId, limit),
    getStats: (userId) => engine.getStats(userId),
  };
}

/**
 * Stop and destroy the singleton engine (for testing/shutdown).
 */
export function stopAutonomyEngine(): void {
  if (engineInstance) {
    engineInstance.stop();
    engineInstance = null;
  }
}
