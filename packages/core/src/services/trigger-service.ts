/**
 * ITriggerService - Trigger Management Interface
 *
 * Provides access to trigger CRUD, execution tracking, and statistics.
 * Supports scheduled, event-based, condition-based, and webhook triggers.
 * All methods accept userId as first parameter for per-user isolation.
 *
 * Usage:
 *   const triggers = registry.get(Services.Trigger);
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

export interface TriggerAction {
  readonly type: 'chat' | 'tool' | 'notification' | 'goal_check' | 'memory_summary' | 'workflow';
  readonly payload: Record<string, unknown>;
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
    durationMs?: number,
  ): Promise<void>;
  getRecentHistory(userId: string, query?: HistoryQuery): Promise<{ history: TriggerHistory[]; total: number }>;
  getHistoryForTrigger(userId: string, triggerId: string, query?: HistoryQuery): Promise<{ history: TriggerHistory[]; total: number }>;
  cleanupHistory(userId: string, maxAgeDays?: number): Promise<number>;

  // Stats
  getStats(userId: string): Promise<TriggerStats>;
}
