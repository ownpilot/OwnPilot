/**
 * Autonomy Engine
 *
 * The "heart and soul" — an AI-driven engine that proactively decides
 * what to do without user prompting. Runs on an adaptive timer (5-15 min),
 * gathers context, evaluates signals, optionally invokes the LLM,
 * executes actions, and reports results.
 *
 * Follows the TriggerEngine singleton lifecycle pattern.
 */

import { generateId, getServiceRegistry, Services, getErrorMessage } from '@ownpilot/core';
import type {
  IPulseService,
  PulseResult,
  PulseStats,
  AutonomyLogEntry,
  IMessageBus,
  NormalizedMessage,
} from '@ownpilot/core';
import { randomUUID } from 'node:crypto';
import { gatherPulseContext } from './context.js';
import { evaluatePulseContext, calculateNextInterval, DEFAULT_RULE_THRESHOLDS, type RuleThresholds } from './evaluator.js';
import { DEFAULT_ACTION_COOLDOWNS, type ActionCooldowns } from './executor.js';
import { getPulseSystemPrompt, buildPulseUserMessage, parsePulseDecision, type PulseAction } from './prompt.js';
import { executePulseActions } from './executor.js';
import { reportPulseResult, type Broadcaster } from './reporter.js';
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
  private broadcaster?: Broadcaster;
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

      // 1. Gather context
      this.setStage('gathering');
      const ctx = await gatherPulseContext(userId);

      // 2. Evaluate signals (skip disabled rules, apply thresholds)
      this.setStage('evaluating');
      const evaluation = evaluatePulseContext(ctx, directives.disabledRules, directives.ruleThresholds);

      // 3. LLM decision (if warranted)
      let llmCalled = false;
      let actionsToExecute: PulseAction[] = [{ type: 'skip', params: {} }];
      let reportMessage = '';

      // Compute cooldown status for the LLM prompt
      const lastActionTimes = this.getLastActionTimes();
      const cooledDownActions: Array<{ type: string; remainingMinutes: number }> = [];
      for (const [actionType, cooldownMin] of Object.entries(directives.actionCooldowns)) {
        if (cooldownMin <= 0) continue;
        const lastTime = lastActionTimes[actionType];
        if (lastTime) {
          const elapsed = (Date.now() - new Date(lastTime).getTime()) / 60_000;
          if (elapsed < cooldownMin) {
            cooledDownActions.push({ type: actionType, remainingMinutes: Math.ceil(cooldownMin - elapsed) });
          }
        }
      }

      if (evaluation.shouldCallLLM) {
        llmCalled = true;
        this.setStage('deciding');
        const decision = await this.callLLM(userId, ctx, evaluation.signals, directives, cooledDownActions);
        actionsToExecute = decision.actions;
        reportMessage = decision.reportMessage;
      }

      // 4. Execute actions (block disabled action types, apply cooldowns)
      this.setStage('executing');
      const { results: actionResults, updatedActionTimes } = await executePulseActions(
        actionsToExecute,
        userId,
        this.config.maxActions,
        directives.blockedActions,
        directives.actionCooldowns,
        lastActionTimes
      );

      // Persist updated action times
      await this.saveLastActionTimes(updatedActionTimes);

      // 5. Build result
      const result: PulseResult = {
        pulseId,
        userId,
        pulsedAt: new Date(),
        durationMs: Date.now() - startTime,
        signalsFound: evaluation.signals.length,
        llmCalled,
        actionsExecuted: actionResults,
        reportMessage,
        urgencyScore: evaluation.urgencyScore,
        manual,
        signalIds: evaluation.signals.map((s) => s.id),
      };

      // 6. Report
      this.setStage('reporting');
      await reportPulseResult(result, this.broadcaster);

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
  // Injection points (wired in server.ts)
  // ============================================================================

  setBroadcaster(broadcaster: Broadcaster): void {
    this.broadcaster = broadcaster;
  }

  private broadcastActivity(
    status: 'started' | 'stage' | 'completed' | 'error',
    stage: string,
    extra?: Record<string, unknown>
  ): void {
    if (!this.broadcaster) return;
    this.broadcaster('pulse:activity', {
      status,
      stage,
      pulseId: this.activePulse?.pulseId ?? null,
      startedAt: this.activePulse?.startedAt ?? null,
      ...extra,
    });
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
    if (settings.quietHoursStart !== undefined) this.config.quietHoursStart = settings.quietHoursStart;
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
      // e.g. 22-07 wraps around midnight (which is the default)
      // Actually for 22-7, start > end, so this branch is e.g. 9-17
      return hour >= start && hour < end;
    }
    // Wraps around midnight (e.g. 22-7)
    return hour >= start || hour < end;
  }

  private async callLLM(
    userId: string,
    ctx: Awaited<ReturnType<typeof gatherPulseContext>>,
    signals: Awaited<ReturnType<typeof evaluatePulseContext>>['signals'],
    directives?: PulseDirectives,
    cooledDownActions?: Array<{ type: string; remainingMinutes: number }>
  ): Promise<ReturnType<typeof parsePulseDecision>> {
    try {
      const registry = getServiceRegistry();
      const bus = registry.get<IMessageBus>(Services.Message);
      const providerService = registry.get(Services.Provider);
      const resolved = await providerService.resolve();
      const provider = resolved.provider ?? 'openai';
      const model = resolved.model ?? 'gpt-4o-mini';

      const systemPrompt = getPulseSystemPrompt(directives?.customInstructions);
      const userMessage = buildPulseUserMessage(ctx, signals, directives?.blockedActions, cooledDownActions);

      const normalized: NormalizedMessage = {
        id: randomUUID(),
        sessionId: `pulse:${userId}`,
        role: 'user',
        content: userMessage,
        metadata: { source: 'system', provider, model },
        timestamp: new Date(),
      };

      // Use the MessageBus pipeline with a pulse-specific system prompt
      const result = await bus.process(normalized, {
        context: {
          userId,
          agentId: 'pulse',
          provider,
          model,
          systemPrompt,
        },
      });

      return parsePulseDecision(result.response.content);
    } catch (error) {
      log.warn('LLM call failed during pulse', { error: String(error) });
      return {
        reasoning: `LLM call failed: ${getErrorMessage(error)}`,
        actions: [{ type: 'skip', params: {} }],
        reportMessage: '',
      };
    }
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
