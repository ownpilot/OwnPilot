/**
 * Heartbeat Service
 *
 * Business logic for heartbeat CRUD with automatic trigger synchronization.
 * Each heartbeat owns one backing trigger (schedule type, chat action).
 */

import {
  getEventBus,
  createEvent,
  EventTypes,
  getServiceRegistry,
  Services,
  type ResourceCreatedData,
  type ResourceUpdatedData,
  type ResourceDeletedData,
} from '@ownpilot/core';
import {
  createHeartbeatsRepository,
  type Heartbeat,
  type HeartbeatQuery,
} from '../db/repositories/heartbeats.js';
import { parseSchedule, parseMarkdown, HeartbeatParseError } from './heartbeat-parser.js';
import { getLog } from './log.js';

const log = getLog('HeartbeatService');

// ============================================================================
// Types
// ============================================================================

export interface CreateHeartbeatServiceInput {
  scheduleText: string;
  taskDescription: string;
  name?: string;
  enabled?: boolean;
  tags?: string[];
}

export interface UpdateHeartbeatServiceInput {
  scheduleText?: string;
  taskDescription?: string;
  name?: string;
  enabled?: boolean;
  tags?: string[];
}

// ============================================================================
// Service
// ============================================================================

export class HeartbeatService {
  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  async createHeartbeat(userId: string, input: CreateHeartbeatServiceInput): Promise<Heartbeat> {
    if (!input.taskDescription?.trim()) {
      throw new HeartbeatServiceError('Task description is required', 'VALIDATION_ERROR');
    }
    if (!input.scheduleText?.trim()) {
      throw new HeartbeatServiceError('Schedule text is required', 'VALIDATION_ERROR');
    }

    // Parse NL schedule → cron
    let cron: string;
    let normalized: string;
    try {
      const result = parseSchedule(input.scheduleText);
      cron = result.cron;
      normalized = result.normalized;
    } catch (e) {
      if (e instanceof HeartbeatParseError) {
        throw new HeartbeatServiceError(e.message, 'PARSE_ERROR');
      }
      throw e;
    }

    const name = input.name || normalized;

    // Create backing trigger
    const triggerService = getServiceRegistry().get(Services.Trigger);
    const trigger = await triggerService.createTrigger(userId, {
      name: `[Heartbeat] ${name}`,
      description: `Auto-managed by heartbeat: ${input.scheduleText}`,
      type: 'schedule',
      config: { cron },
      action: { type: 'chat', payload: { prompt: input.taskDescription } },
      enabled: input.enabled !== false,
    });

    // Create heartbeat record
    const repo = createHeartbeatsRepository(userId);
    const heartbeat = await repo.create({
      name,
      scheduleText: input.scheduleText,
      cron,
      taskDescription: input.taskDescription,
      triggerId: trigger.id,
      enabled: input.enabled !== false,
      tags: input.tags,
    });

    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'heartbeat-service',
      { resourceType: 'heartbeat', id: heartbeat.id },
    ));

    log.info(`Created heartbeat "${name}" with cron ${cron}`, { id: heartbeat.id, triggerId: trigger.id });
    return heartbeat;
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  async getHeartbeat(userId: string, id: string): Promise<Heartbeat | null> {
    const repo = createHeartbeatsRepository(userId);
    return repo.get(id);
  }

  async listHeartbeats(userId: string, query: HeartbeatQuery = {}): Promise<Heartbeat[]> {
    const repo = createHeartbeatsRepository(userId);
    return repo.list(query);
  }

  // --------------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------------

  async updateHeartbeat(userId: string, id: string, input: UpdateHeartbeatServiceInput): Promise<Heartbeat | null> {
    const repo = createHeartbeatsRepository(userId);
    const existing = await repo.get(id);
    if (!existing) return null;

    // Validate taskDescription if provided
    if (input.taskDescription !== undefined && !input.taskDescription.trim()) {
      throw new HeartbeatServiceError('Task description cannot be empty', 'VALIDATION_ERROR');
    }

    let newCron = existing.cron;
    let newScheduleText = existing.scheduleText;

    // Re-parse if scheduleText changed
    if (input.scheduleText && input.scheduleText !== existing.scheduleText) {
      try {
        const result = parseSchedule(input.scheduleText);
        newCron = result.cron;
        newScheduleText = input.scheduleText;
      } catch (e) {
        if (e instanceof HeartbeatParseError) {
          throw new HeartbeatServiceError(e.message, 'PARSE_ERROR');
        }
        throw e;
      }
    }

    // Sync backing trigger
    if (existing.triggerId) {
      const triggerService = getServiceRegistry().get(Services.Trigger);
      const triggerUpdates: Record<string, unknown> = {};

      if (newCron !== existing.cron) {
        triggerUpdates.config = { cron: newCron };
      }
      if (input.taskDescription && input.taskDescription !== existing.taskDescription) {
        triggerUpdates.action = { type: 'chat', payload: { prompt: input.taskDescription } };
      }
      if (input.enabled !== undefined && input.enabled !== existing.enabled) {
        triggerUpdates.enabled = input.enabled;
      }
      if (input.name && input.name !== existing.name) {
        triggerUpdates.name = `[Heartbeat] ${input.name}`;
      }

      if (Object.keys(triggerUpdates).length > 0) {
        await triggerService.updateTrigger(userId, existing.triggerId, triggerUpdates);
      }
    }

    // Update heartbeat record
    const updated = await repo.update(id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.scheduleText && { scheduleText: newScheduleText, cron: newCron }),
      ...(input.taskDescription !== undefined && { taskDescription: input.taskDescription }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.tags !== undefined && { tags: input.tags }),
    });

    if (updated) {
      getEventBus().emit(createEvent<ResourceUpdatedData>(
        EventTypes.RESOURCE_UPDATED, 'resource', 'heartbeat-service',
        { resourceType: 'heartbeat', id, changes: input },
      ));
    }

    return updated;
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  async deleteHeartbeat(userId: string, id: string): Promise<boolean> {
    const repo = createHeartbeatsRepository(userId);
    const existing = await repo.get(id);
    if (!existing) return false;

    // Delete backing trigger
    if (existing.triggerId) {
      const triggerService = getServiceRegistry().get(Services.Trigger);
      await triggerService.deleteTrigger(userId, existing.triggerId);
    }

    const deleted = await repo.delete(id);
    if (deleted) {
      getEventBus().emit(createEvent<ResourceDeletedData>(
        EventTypes.RESOURCE_DELETED, 'resource', 'heartbeat-service',
        { resourceType: 'heartbeat', id },
      ));
    }

    return deleted;
  }

  // --------------------------------------------------------------------------
  // Enable / Disable
  // --------------------------------------------------------------------------

  async enableHeartbeat(userId: string, id: string): Promise<Heartbeat | null> {
    return this.updateHeartbeat(userId, id, { enabled: true });
  }

  async disableHeartbeat(userId: string, id: string): Promise<Heartbeat | null> {
    return this.updateHeartbeat(userId, id, { enabled: false });
  }

  // --------------------------------------------------------------------------
  // Import / Export
  // --------------------------------------------------------------------------

  async importMarkdown(userId: string, markdown: string): Promise<{
    created: number;
    errors: Array<{ scheduleText: string; error: string }>;
    heartbeats: Heartbeat[];
  }> {
    const { entries, errors } = parseMarkdown(markdown);
    const heartbeats: Heartbeat[] = [];
    const importErrors = [...errors];

    for (const entry of entries) {
      try {
        const heartbeat = await this.createHeartbeat(userId, {
          scheduleText: entry.scheduleText,
          taskDescription: entry.taskDescription,
          name: entry.normalized,
        });
        heartbeats.push(heartbeat);
      } catch (e) {
        importErrors.push({
          scheduleText: entry.scheduleText,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    log.info(`Imported ${heartbeats.length} heartbeats, ${importErrors.length} errors`, { userId });
    return { created: heartbeats.length, errors: importErrors, heartbeats };
  }

  async exportMarkdown(userId: string): Promise<string> {
    const repo = createHeartbeatsRepository(userId);
    const heartbeats = await repo.list();

    if (heartbeats.length === 0) return '';

    return heartbeats
      .map((hb) => `## ${hb.scheduleText}\n${hb.taskDescription}`)
      .join('\n\n');
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  async countHeartbeats(userId: string, enabled?: boolean): Promise<number> {
    const repo = createHeartbeatsRepository(userId);
    return repo.count(enabled);
  }
}

// ============================================================================
// Error Type
// ============================================================================

export type HeartbeatServiceErrorCode = 'VALIDATION_ERROR' | 'PARSE_ERROR' | 'NOT_FOUND';

export class HeartbeatServiceError extends Error {
  constructor(
    message: string,
    public readonly code: HeartbeatServiceErrorCode,
  ) {
    super(message);
    this.name = 'HeartbeatServiceError';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: HeartbeatService | null = null;

export function getHeartbeatService(): HeartbeatService {
  if (!instance) {
    instance = new HeartbeatService();
  }
  return instance;
}
