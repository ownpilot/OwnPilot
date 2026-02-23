/**
 * Pulse Action Executor
 *
 * Maps LLM-decided actions to actual service calls. Before each action,
 * risk is assessed and the action may be skipped if it requires approval
 * under the current AutonomyConfig.
 */

import { getServiceRegistry, Services, getErrorMessage } from '@ownpilot/core';
import type { PulseActionResult } from '@ownpilot/core';
import { assessRisk, DEFAULT_AUTONOMY_CONFIG, type AutonomyConfig } from './index.js';
import type { PulseAction } from './prompt.js';
import { PULSE_MAX_ACTIONS } from '../config/defaults.js';
import { getLog } from '../services/log.js';

const log = getLog('PulseExecutor');

// ============================================================================
// Action Cooldowns
// ============================================================================

export interface ActionCooldowns {
  create_memory: number;
  update_goal_progress: number;
  send_notification: number;
  run_memory_cleanup: number;
}

export const DEFAULT_ACTION_COOLDOWNS: ActionCooldowns = {
  create_memory: 30,
  update_goal_progress: 60,
  send_notification: 15,
  run_memory_cleanup: 360,
};

// ============================================================================
// Risk assessment helpers
// ============================================================================

/** Map pulse action types to ActionCategory for risk assessment */
const ACTION_CATEGORY_MAP: Record<string, import('./types.js').ActionCategory> = {
  create_memory: 'memory_modification',
  update_goal_progress: 'goal_modification',
  send_notification: 'notification',
  run_memory_cleanup: 'memory_modification',
  skip: 'notification',
};

function getAutonomyConfig(userId: string): AutonomyConfig {
  return {
    ...DEFAULT_AUTONOMY_CONFIG,
    userId,
    budgetResetAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================================================
// Executor
// ============================================================================

/**
 * Execute a list of pulse actions, respecting risk assessment, cooldowns, and action limits.
 */
export async function executePulseActions(
  actions: PulseAction[],
  userId: string,
  maxActions = PULSE_MAX_ACTIONS,
  blockedActions: string[] = [],
  cooldowns: ActionCooldowns = DEFAULT_ACTION_COOLDOWNS,
  lastActionTimes: Record<string, string> = {}
): Promise<{ results: PulseActionResult[]; updatedActionTimes: Record<string, string> }> {
  // Bound the number of actions
  const bounded = actions.slice(0, maxActions);
  const results: PulseActionResult[] = [];
  const updatedActionTimes = { ...lastActionTimes };

  for (const action of bounded) {
    if (action.type === 'skip') {
      results.push({ type: 'skip', success: true, skipped: true });
      continue;
    }

    // Check if action type is blocked by user directives
    if (blockedActions.includes(action.type)) {
      results.push({
        type: action.type,
        success: false,
        skipped: true,
        error: 'Action type disabled by user',
      });
      continue;
    }

    // Cooldown check
    const cooldownMinutes = cooldowns[action.type as keyof ActionCooldowns] ?? 0;
    if (cooldownMinutes > 0) {
      const lastTime = updatedActionTimes[action.type];
      if (lastTime) {
        const elapsed = (Date.now() - new Date(lastTime).getTime()) / 60_000;
        if (elapsed < cooldownMinutes) {
          results.push({
            type: action.type,
            success: false,
            skipped: true,
            error: `Action in cooldown (${Math.ceil(cooldownMinutes - elapsed)} min remaining)`,
          });
          continue;
        }
      }
    }

    // Assess risk
    const category = ACTION_CATEGORY_MAP[action.type] ?? 'tool_execution';
    const config = getAutonomyConfig(userId);
    const risk = assessRisk(category, action.type, action.params, {}, config);

    if (risk.requiresApproval) {
      log.info(`Pulse action "${action.type}" skipped (requires approval, risk: ${risk.level})`);
      results.push({
        type: action.type,
        success: false,
        skipped: true,
        error: `Skipped: requires approval (risk: ${risk.level})`,
      });
      continue;
    }

    // Execute the action
    const result = await executeAction(action, userId);
    results.push(result);

    // Update last action time on success
    if (result.success) {
      updatedActionTimes[action.type] = new Date().toISOString();
    }
  }

  return { results, updatedActionTimes };
}

// ============================================================================
// Individual action executors
// ============================================================================

async function executeAction(action: PulseAction, userId: string): Promise<PulseActionResult> {
  try {
    switch (action.type) {
      case 'create_memory':
        return await executeCreateMemory(action.params, userId);

      case 'update_goal_progress':
        return await executeUpdateGoalProgress(action.params, userId);

      case 'send_notification':
        // Notifications are handled by the reporter, not here
        return {
          type: action.type,
          success: true,
          output: { message: action.params.message, urgency: action.params.urgency },
        };

      case 'run_memory_cleanup':
        return await executeMemoryCleanup(action.params, userId);

      default:
        return { type: action.type, success: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (error) {
    log.warn(`Pulse action "${action.type}" failed`, { error: String(error) });
    return { type: action.type, success: false, error: getErrorMessage(error) };
  }
}

async function executeCreateMemory(
  params: Record<string, unknown>,
  userId: string
): Promise<PulseActionResult> {
  const registry = getServiceRegistry();
  const memoryService = registry.get(Services.Memory);

  const memory = await memoryService.createMemory(userId, {
    content: params.content as string,
    type: (params.type as 'fact' | 'preference' | 'event') ?? 'fact',
    importance: (params.importance as number) ?? 0.5,
    source: 'pulse',
  });

  return {
    type: 'create_memory',
    success: true,
    output: { memoryId: memory.id },
  };
}

async function executeUpdateGoalProgress(
  params: Record<string, unknown>,
  userId: string
): Promise<PulseActionResult> {
  const registry = getServiceRegistry();
  const goalService = registry.get(Services.Goal);

  const goalId = params.goalId as string;
  const progress = params.progress as number;
  const note = params.note as string | undefined;

  const updated = await goalService.updateGoal(userId, goalId, {
    progress,
    description: note,
  });

  if (!updated) {
    return { type: 'update_goal_progress', success: false, error: `Goal not found: ${goalId}` };
  }

  return {
    type: 'update_goal_progress',
    success: true,
    output: { goalId, progress },
  };
}

async function executeMemoryCleanup(
  params: Record<string, unknown>,
  userId: string
): Promise<PulseActionResult> {
  const registry = getServiceRegistry();
  const memoryService = registry.get(Services.Memory);

  const minImportance = (params.minImportance as number) ?? 0.2;

  // Get low-importance memories via getImportantMemories with a low threshold
  const memories = await memoryService.getImportantMemories(userId, {
    threshold: 0,
    limit: 50,
  });

  const toDelete = memories.filter((m) => m.importance < minImportance);
  let deleted = 0;
  for (const mem of toDelete) {
    const ok = await memoryService.deleteMemory(userId, mem.id);
    if (ok) deleted++;
  }

  return {
    type: 'run_memory_cleanup',
    success: true,
    output: { checked: memories.length, deleted },
  };
}
