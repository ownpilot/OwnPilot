/**
 * TriggerService Implementation
 *
 * Wraps the existing TriggerService to provide ITriggerService interface.
 * Direct pass-through adapter since gateway types are compatible.
 *
 * Usage:
 *   const triggers = registry.get(Services.Trigger);
 *   const trigger = await triggers.createTrigger('user-1', { name: 'Daily check', ... });
 */

import type {
  ITriggerService,
  CreateTriggerInput,
  UpdateTriggerInput,
  TriggerQuery,
  TriggerHistoryQuery as HistoryQuery,
  TriggerExecutionStatus as TriggerStatus,
  ServiceTrigger as Trigger,
  ServiceTriggerHistory as TriggerHistory,
  TriggerServiceStats as TriggerStats,
} from '@ownpilot/core';
import { getTriggerService } from './trigger-service.js';

// ============================================================================
// TriggerServiceImpl Adapter
// ============================================================================

export class TriggerServiceImpl implements ITriggerService {
  private get service() {
    return getTriggerService();
  }

  // ---- CRUD ----

  async createTrigger(userId: string, input: CreateTriggerInput): Promise<Trigger> {
    return this.service.createTrigger(userId, input);
  }

  async getTrigger(userId: string, id: string): Promise<Trigger | null> {
    return this.service.getTrigger(userId, id);
  }

  async listTriggers(userId: string, query?: TriggerQuery): Promise<Trigger[]> {
    return this.service.listTriggers(userId, query);
  }

  async updateTrigger(
    userId: string,
    id: string,
    input: UpdateTriggerInput,
  ): Promise<Trigger | null> {
    return this.service.updateTrigger(userId, id, input);
  }

  async deleteTrigger(userId: string, id: string): Promise<boolean> {
    return this.service.deleteTrigger(userId, id);
  }

  // ---- Queries ----

  async getDueTriggers(userId: string): Promise<Trigger[]> {
    return this.service.getDueTriggers(userId);
  }

  async getByEventType(userId: string, eventType: string): Promise<Trigger[]> {
    return this.service.getByEventType(userId, eventType);
  }

  async getConditionTriggers(userId: string): Promise<Trigger[]> {
    return this.service.getConditionTriggers(userId);
  }

  // ---- Execution Tracking ----

  async markFired(userId: string, id: string, nextFire?: string): Promise<void> {
    return this.service.markFired(userId, id, nextFire);
  }

  async logExecution(
    userId: string,
    triggerId: string,
    triggerName: string,
    status: TriggerStatus,
    result?: unknown,
    error?: string,
    durationMs?: number,
  ): Promise<void> {
    return this.service.logExecution(userId, triggerId, triggerName, status, result, error, durationMs);
  }

  async getRecentHistory(userId: string, query?: HistoryQuery): Promise<{ history: TriggerHistory[]; total: number }> {
    return this.service.getRecentHistory(userId, query);
  }

  async getHistoryForTrigger(
    userId: string,
    triggerId: string,
    query?: HistoryQuery,
  ): Promise<{ history: TriggerHistory[]; total: number }> {
    return this.service.getHistoryForTrigger(userId, triggerId, query);
  }

  async cleanupHistory(userId: string, maxAgeDays?: number): Promise<number> {
    return this.service.cleanupHistory(userId, maxAgeDays);
  }

  // ---- Stats ----

  async getStats(userId: string): Promise<TriggerStats> {
    return this.service.getStats(userId);
  }
}

/**
 * Create a new TriggerServiceImpl instance.
 */
export function createTriggerServiceImpl(): ITriggerService {
  return new TriggerServiceImpl();
}
