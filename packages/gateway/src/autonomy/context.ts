/**
 * Pulse Context Gatherer
 *
 * Collects system state for the pulse evaluator. Each data source is
 * independently wrapped in try/catch so partial failures produce
 * zero-values rather than aborting the entire gather.
 */

import { getServiceRegistry, Services } from '@ownpilot/core';
import { MS_PER_DAY } from '../config/defaults.js';
import { getLog } from '../services/log.js';

const log = getLog('PulseContext');

// ============================================================================
// Types
// ============================================================================

export interface GoalSummary {
  id: string;
  title: string;
  progress: number;
  updatedAt: Date;
  dueDate: string | null;
}

export interface PulseContext {
  userId: string;
  gatheredAt: Date;
  timeContext: {
    hour: number;
    dayOfWeek: number;
    isWeekend: boolean;
  };
  goals: {
    active: GoalSummary[];
    stale: Array<{ id: string; title: string; daysSinceUpdate: number }>;
    upcoming: Array<{ id: string; title: string; daysUntilDue: number }>;
  };
  memories: {
    total: number;
    recentCount: number;
    avgImportance: number;
  };
  activity: {
    daysSinceLastActivity: number;
    hasRecentActivity: boolean;
  };
  systemHealth: {
    pendingApprovals: number;
    triggerErrors: number;
  };
}

// ============================================================================
// Gatherer
// ============================================================================

export async function gatherPulseContext(userId: string): Promise<PulseContext> {
  const now = new Date();
  const registry = getServiceRegistry();

  const ctx: PulseContext = {
    userId,
    gatheredAt: now,
    timeContext: {
      hour: now.getHours(),
      dayOfWeek: now.getDay(),
      isWeekend: now.getDay() === 0 || now.getDay() === 6,
    },
    goals: { active: [], stale: [], upcoming: [] },
    memories: { total: 0, recentCount: 0, avgImportance: 0 },
    activity: { daysSinceLastActivity: 0, hasRecentActivity: true },
    systemHealth: { pendingApprovals: 0, triggerErrors: 0 },
  };

  // Gather all data sources in parallel, each wrapped in try/catch
  await Promise.all([
    gatherGoals(registry, userId, now, ctx),
    gatherMemories(registry, userId, ctx),
    gatherActivity(registry, userId, now, ctx),
    gatherSystemHealth(registry, userId, ctx),
  ]);

  return ctx;
}

// ============================================================================
// Data Source Gatherers
// ============================================================================

async function gatherGoals(
  registry: ReturnType<typeof getServiceRegistry>,
  userId: string,
  now: Date,
  ctx: PulseContext
): Promise<void> {
  try {
    const goalService = registry.get(Services.Goal);
    const activeGoals = await goalService.listGoals(userId, { status: 'active', limit: 50 });

    ctx.goals.active = activeGoals.map((g) => ({
      id: g.id,
      title: g.title,
      progress: g.progress,
      updatedAt: g.updatedAt,
      dueDate: g.dueDate ?? null,
    }));

    // Stale goals (not updated in >3 days)
    const threeDaysMs = 3 * MS_PER_DAY;
    ctx.goals.stale = activeGoals
      .filter((g) => now.getTime() - g.updatedAt.getTime() > threeDaysMs)
      .map((g) => ({
        id: g.id,
        title: g.title,
        daysSinceUpdate: Math.floor((now.getTime() - g.updatedAt.getTime()) / MS_PER_DAY),
      }));

    // Upcoming deadlines (within 7 days)
    const sevenDaysMs = 7 * MS_PER_DAY;
    ctx.goals.upcoming = activeGoals
      .filter((g) => {
        if (!g.dueDate) return false;
        const dueMs = new Date(g.dueDate).getTime();
        return dueMs - now.getTime() <= sevenDaysMs && dueMs > now.getTime();
      })
      .map((g) => ({
        id: g.id,
        title: g.title,
        daysUntilDue: Math.ceil((new Date(g.dueDate!).getTime() - now.getTime()) / MS_PER_DAY),
      }));
  } catch (error) {
    log.debug('Failed to gather goals', { error: String(error) });
  }
}

async function gatherMemories(
  registry: ReturnType<typeof getServiceRegistry>,
  userId: string,
  ctx: PulseContext
): Promise<void> {
  try {
    const memoryService = registry.get(Services.Memory);
    const stats = await memoryService.getStats(userId);
    ctx.memories.total = stats.total;
    ctx.memories.recentCount = stats.recentCount ?? 0;
    ctx.memories.avgImportance = stats.avgImportance ?? 0;
  } catch (error) {
    log.debug('Failed to gather memories', { error: String(error) });
  }
}

async function gatherActivity(
  _registry: ReturnType<typeof getServiceRegistry>,
  userId: string,
  now: Date,
  ctx: PulseContext
): Promise<void> {
  try {
    // Check last conversation activity via DB
    const { createConversationsRepository } = await import('../db/repositories/conversations.js');
    const convRepo = createConversationsRepository();
    const recent = await convRepo.getAll(1, 0);
    if (recent.length > 0) {
      const lastConv = recent[0]!;
      const lastActivity = lastConv.updatedAt;
      const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / MS_PER_DAY);
      ctx.activity.daysSinceLastActivity = daysSince;
      ctx.activity.hasRecentActivity = daysSince < 2;
    } else {
      ctx.activity.daysSinceLastActivity = 999;
      ctx.activity.hasRecentActivity = false;
    }
  } catch (error) {
    log.debug('Failed to gather activity', { error: String(error) });
    ctx.activity.daysSinceLastActivity = 0;
    ctx.activity.hasRecentActivity = true;
  }
}

async function gatherSystemHealth(
  _registry: ReturnType<typeof getServiceRegistry>,
  _userId: string,
  ctx: PulseContext
): Promise<void> {
  try {
    // Check pending approvals
    const { getApprovalManager } = await import('./approvals.js');
    const approvalMgr = getApprovalManager();
    const pending = approvalMgr.getPendingActions(_userId);
    ctx.systemHealth.pendingApprovals = pending.length;
  } catch {
    // Approval manager may not be initialized
  }

  try {
    // Check trigger errors in last 24h
    const { createTriggersRepository } = await import('../db/repositories/triggers.js');
    const triggersRepo = createTriggersRepository(_userId);
    const oneDayAgo = new Date(Date.now() - MS_PER_DAY);
    const { total } = await triggersRepo.getRecentHistory({
      status: 'failure',
      from: oneDayAgo.toISOString(),
      limit: 1,
    });
    ctx.systemHealth.triggerErrors = total;
  } catch {
    // Triggers repo may not be available
  }
}
