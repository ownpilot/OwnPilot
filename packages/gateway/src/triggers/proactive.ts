/**
 * Proactive Behaviors
 *
 * Built-in proactive behaviors for the autonomous AI assistant.
 * These can be enabled/disabled and customized by the user.
 */

import { type CreateTriggerInput } from '../db/repositories/triggers.js';
import { getServiceRegistry, Services } from '@ownpilot/core';
import { getLog } from '../services/log.js';

const log = getLog('Proactive');

// ============================================================================
// Default Trigger Definitions
// ============================================================================

export const DEFAULT_TRIGGERS: CreateTriggerInput[] = [
  // Morning briefing - daily at 8 AM
  {
    name: 'Morning Briefing',
    description: 'Generate a daily morning briefing with tasks, goals, and events',
    type: 'schedule',
    config: {
      cron: '0 8 * * *',
      timezone: 'local',
    },
    action: {
      type: 'chat',
      payload: {
        prompt:
          'Generate a morning briefing including: active goals and their progress, upcoming deadlines, scheduled events today, and suggested priorities for the day.',
      },
    },
    priority: 7,
    enabled: false, // Disabled by default - user must enable
  },

  // Goal reminder - check for stale goals
  {
    name: 'Stale Goal Reminder',
    description: 'Remind about goals that have not been updated recently',
    type: 'condition',
    config: {
      condition: 'stale_goals',
      threshold: 3, // Days without update
      checkInterval: 360, // Check every 6 hours
    },
    action: {
      type: 'notification',
      payload: {
        message: 'You have goals that need attention. Would you like to review them?',
      },
    },
    priority: 5,
    enabled: false,
  },

  // Deadline warning - upcoming deadlines
  {
    name: 'Deadline Warning',
    description: 'Alert about goals with approaching deadlines',
    type: 'condition',
    config: {
      condition: 'upcoming_deadline',
      threshold: 3, // Days until deadline
      checkInterval: 720, // Check every 12 hours
    },
    action: {
      type: 'notification',
      payload: {
        message: 'You have deadlines approaching in the next few days.',
      },
    },
    priority: 8,
    enabled: false,
  },

  // Weekly memory summary
  {
    name: 'Weekly Memory Summary',
    description: 'Summarize memories and learning from the past week',
    type: 'schedule',
    config: {
      cron: '0 18 * * 0', // Sunday at 6 PM
      timezone: 'local',
    },
    action: {
      type: 'memory_summary',
      payload: {},
    },
    priority: 4,
    enabled: false,
  },

  // Low progress alert
  {
    name: 'Low Progress Alert',
    description: 'Alert when active goals have very low progress',
    type: 'condition',
    config: {
      condition: 'low_progress',
      threshold: 10, // Progress below 10%
      checkInterval: 1440, // Check daily
    },
    action: {
      type: 'goal_check',
      payload: {
        staleDays: 7,
      },
    },
    priority: 5,
    enabled: false,
  },

  // Daily goal check
  {
    name: 'Daily Goal Check',
    description: 'Review goal progress at end of day',
    type: 'schedule',
    config: {
      cron: '0 21 * * *', // 9 PM daily
      timezone: 'local',
    },
    action: {
      type: 'chat',
      payload: {
        prompt:
          'Review my goal progress for today. What did I accomplish? What should I focus on tomorrow?',
      },
    },
    priority: 6,
    enabled: false,
  },
];

// ============================================================================
// Setup Functions
// ============================================================================

/**
 * Initialize default triggers for a user
 * Only creates triggers that don't already exist
 */
export async function initializeDefaultTriggers(userId = 'default'): Promise<{
  created: number;
  skipped: number;
}> {
  const service = getServiceRegistry().get(Services.Trigger);
  const existing = await service.listTriggers(userId, { limit: 100 });
  const existingNames = new Set(existing.map((t) => t.name));

  let created = 0;
  let skipped = 0;

  for (const trigger of DEFAULT_TRIGGERS) {
    if (existingNames.has(trigger.name)) {
      skipped++;
      continue;
    }

    try {
      await service.createTrigger(userId, trigger);
      created++;
    } catch (error) {
      log.error(`[Proactive] Failed to create trigger "${trigger.name}":`, error);
      skipped++;
    }
  }

  if (created > 0) {
    log.info(`[Proactive] Created ${created} default triggers for user ${userId}`);
  }

  return { created, skipped };
}

/**
 * Get status of proactive features
 */
export async function getProactiveStatus(userId = 'default'): Promise<{
  triggers: Array<{
    name: string;
    enabled: boolean;
    lastFired: Date | null;
    fireCount: number;
  }>;
  enabledCount: number;
  totalFires: number;
}> {
  const service = getServiceRegistry().get(Services.Trigger);
  const triggers = await service.listTriggers(userId, { limit: 100 });

  // Filter to only show the default proactive triggers
  const defaultNames = new Set(DEFAULT_TRIGGERS.map((t) => t.name));
  const proactiveTriggers = triggers.filter((t) => defaultNames.has(t.name));

  return {
    triggers: proactiveTriggers.map((t) => ({
      name: t.name,
      enabled: t.enabled,
      lastFired: t.lastFired,
      fireCount: t.fireCount,
    })),
    enabledCount: proactiveTriggers.filter((t) => t.enabled).length,
    totalFires: proactiveTriggers.reduce((sum, t) => sum + t.fireCount, 0),
  };
}

/**
 * Enable a proactive feature by name
 */
export async function enableProactiveFeature(name: string, userId = 'default'): Promise<boolean> {
  const service = getServiceRegistry().get(Services.Trigger);
  const triggers = await service.listTriggers(userId, { limit: 100 });
  const trigger = triggers.find((t) => t.name === name);

  if (!trigger) {
    return false;
  }

  await service.updateTrigger(userId, trigger.id, { enabled: true });
  return true;
}

/**
 * Disable a proactive feature by name
 */
export async function disableProactiveFeature(name: string, userId = 'default'): Promise<boolean> {
  const service = getServiceRegistry().get(Services.Trigger);
  const triggers = await service.listTriggers(userId, { limit: 100 });
  const trigger = triggers.find((t) => t.name === name);

  if (!trigger) {
    return false;
  }

  await service.updateTrigger(userId, trigger.id, { enabled: false });
  return true;
}

/**
 * Enable all proactive features
 */
export async function enableAllProactive(userId = 'default'): Promise<number> {
  const service = getServiceRegistry().get(Services.Trigger);
  const triggers = await service.listTriggers(userId, { limit: 100 });
  const defaultNames = new Set(DEFAULT_TRIGGERS.map((t) => t.name));

  let enabled = 0;
  for (const trigger of triggers) {
    if (defaultNames.has(trigger.name) && !trigger.enabled) {
      await service.updateTrigger(userId, trigger.id, { enabled: true });
      enabled++;
    }
  }

  return enabled;
}

/**
 * Disable all proactive features
 */
export async function disableAllProactive(userId = 'default'): Promise<number> {
  const service = getServiceRegistry().get(Services.Trigger);
  const triggers = await service.listTriggers(userId, { limit: 100 });
  const defaultNames = new Set(DEFAULT_TRIGGERS.map((t) => t.name));

  let disabled = 0;
  for (const trigger of triggers) {
    if (defaultNames.has(trigger.name) && trigger.enabled) {
      await service.updateTrigger(userId, trigger.id, { enabled: false });
      disabled++;
    }
  }

  return disabled;
}
