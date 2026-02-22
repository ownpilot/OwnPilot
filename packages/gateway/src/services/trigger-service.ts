/**
 * Trigger Service
 *
 * Central business logic for trigger operations.
 * Wraps TriggersRepository with event emission and validation.
 * Complex scheduling/execution logic lives in TriggerEngine.
 */

import {
  getEventBus,
  createEvent,
  EventTypes,
  type ITriggerService,
  type ResourceCreatedData,
  type ResourceUpdatedData,
  type ResourceDeletedData,
} from '@ownpilot/core';
import {
  TriggersRepository,
  createTriggersRepository,
  type Trigger,
  type TriggerHistory,
  type HistoryQuery,
  type TriggerQuery,
  type CreateTriggerInput,
  type UpdateTriggerInput,
} from '../db/repositories/triggers.js';

// ============================================================================
// Types
// ============================================================================

export interface TriggerStats {
  total: number;
  enabled: number;
  byType: Record<string, number>;
  totalFires: number;
  firesThisWeek: number;
  successRate: number;
}

// ============================================================================
// TriggerService
// ============================================================================

export class TriggerService implements ITriggerService {
  private getRepo(userId: string): TriggersRepository {
    return createTriggersRepository(userId);
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async createTrigger(userId: string, input: CreateTriggerInput): Promise<Trigger> {
    if (!input.name?.trim()) {
      throw new TriggerServiceError('Name is required', 'VALIDATION_ERROR');
    }
    const repo = this.getRepo(userId);
    const trigger = await repo.create(input);
    getEventBus().emit(
      createEvent<ResourceCreatedData>(EventTypes.RESOURCE_CREATED, 'resource', 'trigger-service', {
        resourceType: 'trigger',
        id: trigger.id,
      })
    );
    return trigger;
  }

  async getTrigger(userId: string, id: string): Promise<Trigger | null> {
    const repo = this.getRepo(userId);
    return repo.get(id);
  }

  async listTriggers(userId: string, query: TriggerQuery = {}): Promise<Trigger[]> {
    const repo = this.getRepo(userId);
    return repo.list(query);
  }

  async updateTrigger(
    userId: string,
    id: string,
    input: UpdateTriggerInput
  ): Promise<Trigger | null> {
    const repo = this.getRepo(userId);
    const updated = await repo.update(id, input);
    if (updated) {
      getEventBus().emit(
        createEvent<ResourceUpdatedData>(
          EventTypes.RESOURCE_UPDATED,
          'resource',
          'trigger-service',
          { resourceType: 'trigger', id, changes: input }
        )
      );
    }
    return updated;
  }

  async deleteTrigger(userId: string, id: string): Promise<boolean> {
    const repo = this.getRepo(userId);
    const deleted = await repo.delete(id);
    if (deleted) {
      getEventBus().emit(
        createEvent<ResourceDeletedData>(
          EventTypes.RESOURCE_DELETED,
          'resource',
          'trigger-service',
          { resourceType: 'trigger', id }
        )
      );
    }
    return deleted;
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  async getDueTriggers(userId: string): Promise<Trigger[]> {
    const repo = this.getRepo(userId);
    return repo.getDueTriggers();
  }

  async getByEventType(userId: string, eventType: string): Promise<Trigger[]> {
    const repo = this.getRepo(userId);
    return repo.getByEventType(eventType);
  }

  async getConditionTriggers(userId: string): Promise<Trigger[]> {
    const repo = this.getRepo(userId);
    return repo.getConditionTriggers();
  }

  // --------------------------------------------------------------------------
  // Execution Tracking
  // --------------------------------------------------------------------------

  async markFired(userId: string, id: string, nextFire?: string): Promise<void> {
    const repo = this.getRepo(userId);
    await repo.markFired(id, nextFire);
  }

  async logExecution(
    userId: string,
    triggerId: string,
    triggerName: string,
    status: 'success' | 'failure' | 'skipped',
    result?: unknown,
    error?: string,
    durationMs?: number
  ): Promise<void> {
    const repo = this.getRepo(userId);
    await repo.logExecution(triggerId, triggerName, status, result, error, durationMs);
  }

  async getRecentHistory(
    userId: string,
    query: HistoryQuery = {}
  ): Promise<{ history: TriggerHistory[]; total: number }> {
    const repo = this.getRepo(userId);
    const result = await repo.getRecentHistory(query);
    return { history: result.rows, total: result.total };
  }

  async getHistoryForTrigger(
    userId: string,
    triggerId: string,
    query: HistoryQuery = {}
  ): Promise<{ history: TriggerHistory[]; total: number }> {
    const repo = this.getRepo(userId);
    const result = await repo.getHistoryForTrigger(triggerId, query);
    return { history: result.rows, total: result.total };
  }

  async cleanupHistory(userId: string, maxAgeDays = 30): Promise<number> {
    if (maxAgeDays <= 0) {
      throw new TriggerServiceError('maxAgeDays must be positive', 'VALIDATION_ERROR');
    }
    const repo = this.getRepo(userId);
    return repo.cleanupHistory(maxAgeDays);
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  async getStats(userId: string): Promise<TriggerStats> {
    const repo = this.getRepo(userId);
    return repo.getStats();
  }
}

// ============================================================================
// Error Type
// ============================================================================

export type TriggerServiceErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR';

export class TriggerServiceError extends Error {
  constructor(
    message: string,
    public readonly code: TriggerServiceErrorCode
  ) {
    super(message);
    this.name = 'TriggerServiceError';
  }
}

// ============================================================================
// Singleton (internal — use ServiceRegistry instead)
// ============================================================================

let instance: TriggerService | null = null;

export function getTriggerService(): TriggerService {
  if (!instance) {
    instance = new TriggerService();
  }
  return instance;
}
