/**
 * ITriggerService - Trigger Management Interface
 *
 * Provides access to trigger CRUD, execution tracking, and statistics.
 * Supports scheduled, event-based, condition-based, and webhook triggers.
 * All methods accept userId as first parameter for per-user isolation.
 *
 * Usage:
 *   const triggers = getTriggerService();
 *   const trigger = await triggers.createTrigger('user-1', { name: 'Daily check', type: 'schedule', ... });
 */

// ============================================================================
// Trigger Types
// ============================================================================

export type TriggerType = 'schedule' | 'event' | 'condition' | 'webhook';
export type TriggerStatus = 'success' | 'failure' | 'skipped';

export interface ScheduleConfig {
  readonly cron: string;
  readonly timezone?: string;
}

export interface EventConfig {
  readonly eventType: string;
  readonly filters?: Record<string, unknown>;
}

export interface ConditionConfig {
  readonly condition: string;
  readonly threshold?: number;
  readonly checkInterval?: number;
}

export interface WebhookConfig {
  readonly secret?: string;
  readonly allowedSources?: string[];
}

export type TriggerConfig = ScheduleConfig | EventConfig | ConditionConfig | WebhookConfig;

/**
 * Optional pre-run script for zero-token gating ("no-agent mode").
 * Runs in an isolated JS sandbox before the action. The script body may
 * `return { wakeAgent, output?, context? }`:
 *   - `wakeAgent === false` skips the LLM/tool action entirely (optionally
 *     delivering `output` verbatim) — no tokens spent when state is unchanged.
 *   - otherwise `context` is merged into the action payload.
 */
interface TriggerPreRun {
  readonly code: string;
  readonly timeoutMs?: number;
}

export interface TriggerAction {
  readonly type:
    | 'chat'
    | 'tool'
    | 'notification'
    | 'goal_check'
    | 'memory_summary'
    | 'workflow'
    | 'profile_learn'
    | 'memory_extract'
    | 'memory_consolidate';
  readonly payload: Record<string, unknown>;
  /** Pre-run gating script — see TriggerPreRun. */
  readonly preRun?: TriggerPreRun;
  /** When true, deliver pre-run output verbatim and never run the main action. */
  readonly noAgentMode?: boolean;
  /** Chain input: inject the most recent successful result of this trigger id. */
  readonly contextFrom?: string;
}

export interface Trigger {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: TriggerType;
  readonly config: TriggerConfig;
  readonly action: TriggerAction;
  readonly enabled: boolean;
  readonly priority: number;
  readonly lastFired: Date | null;
  readonly nextFire: Date | null;
  readonly fireCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TriggerHistory {
  readonly id: string;
  readonly triggerId: string | null;
  readonly triggerName: string | null;
  readonly firedAt: Date;
  readonly status: TriggerStatus;
  readonly result: unknown | null;
  readonly error: string | null;
  readonly durationMs: number | null;
}

export interface TriggerStats {
  readonly total: number;
  readonly enabled: number;
  readonly byType: Record<string, number>;
  readonly totalFires: number;
  readonly firesThisWeek: number;
  readonly successRate: number;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateTriggerInput {
  readonly name: string;
  readonly description?: string;
  readonly type: TriggerType;
  readonly config: TriggerConfig;
  readonly action: TriggerAction;
  readonly enabled?: boolean;
  readonly priority?: number;
}

export interface UpdateTriggerInput {
  readonly name?: string;
  readonly description?: string;
  readonly config?: TriggerConfig;
  readonly action?: TriggerAction;
  readonly enabled?: boolean;
  readonly priority?: number;
}

export interface TriggerQuery {
  readonly type?: TriggerType | TriggerType[];
  readonly enabled?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface HistoryQuery {
  readonly status?: TriggerStatus;
  readonly triggerId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

// ============================================================================
// ITriggerService
// ============================================================================

export interface ITriggerService {
  // CRUD
  createTrigger(userId: string, input: CreateTriggerInput): Promise<Trigger>;
  getTrigger(userId: string, id: string): Promise<Trigger | null>;
  listTriggers(userId: string, query?: TriggerQuery): Promise<Trigger[]>;
  updateTrigger(userId: string, id: string, input: UpdateTriggerInput): Promise<Trigger | null>;
  deleteTrigger(userId: string, id: string): Promise<boolean>;

  // Queries
  getDueTriggers(userId: string): Promise<Trigger[]>;
  getByEventType(userId: string, eventType: string): Promise<Trigger[]>;
  getConditionTriggers(userId: string): Promise<Trigger[]>;

  // Execution Tracking
  markFired(userId: string, id: string, nextFire?: string): Promise<void>;
  logExecution(
    userId: string,
    triggerId: string,
    triggerName: string,
    status: TriggerStatus,
    result?: unknown,
    error?: string,
    durationMs?: number
  ): Promise<void>;
  getRecentHistory(
    userId: string,
    query?: HistoryQuery
  ): Promise<{ history: TriggerHistory[]; total: number }>;
  getHistoryForTrigger(
    userId: string,
    triggerId: string,
    query?: HistoryQuery
  ): Promise<{ history: TriggerHistory[]; total: number }>;
  cleanupHistory(userId: string, maxAgeDays?: number): Promise<number>;

  // Stats
  getStats(userId: string): Promise<TriggerStats>;
}

// ============================================================================
// Singleton access — matches the MemoryService / GoalService pattern.
// Trigger is a domain CRUD service with a typed accessor; not added to
// RuntimeContext because it's used by routes + orchestrators rather than
// shared runtime infrastructure.
// ============================================================================

import { hasServiceRegistry, getServiceRegistry } from './registry.js';
import { ServiceToken } from './registry.js';

export const TriggerToken = new ServiceToken<ITriggerService>('trigger');

let _triggerService: ITriggerService | null = null;

export function setTriggerService(service: ITriggerService): void {
  _triggerService = service;

  if (hasServiceRegistry()) {
    try {
      const registry = getServiceRegistry();
      if (!registry.has(TriggerToken)) {
        registry.register(TriggerToken, service);
      }
    } catch {
      // Registry not ready
    }
  }
}

export function getTriggerService(): ITriggerService {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(TriggerToken);
    } catch {
      // Not registered yet — fall through to direct singleton
    }
  }

  if (!_triggerService) {
    throw new Error(
      'TriggerService not initialized. Call setTriggerService() during gateway startup.'
    );
  }
  return _triggerService;
}

export function hasTriggerService(): boolean {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().has(TriggerToken);
    } catch {
      // fall through
    }
  }
  return _triggerService !== null;
}
