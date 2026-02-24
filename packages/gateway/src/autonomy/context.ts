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
  habits: {
    todayHabits: Array<{ name: string; completed: boolean; streak: number }>;
    todayProgress: number;
  };
  tasks: {
    overdue: Array<{ title: string; dueDate: string }>;
    dueToday: Array<{ title: string; priority: string }>;
  };
  calendar: {
    todayEvents: Array<{ title: string; startTime: string }>;
    tomorrowEvents: Array<{ title: string; startTime: string }>;
  };
  recentMemories: Array<{ content: string; type: string; importance: number }>;
  userLocation?: string;
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
    habits: { todayHabits: [], todayProgress: 0 },
    tasks: { overdue: [], dueToday: [] },
    calendar: { todayEvents: [], tomorrowEvents: [] },
    recentMemories: [],
  };

  // Gather all data sources in parallel, each wrapped in try/catch
  await Promise.all([
    gatherGoals(registry, userId, now, ctx),
    gatherMemories(registry, userId, ctx),
    gatherActivity(registry, userId, now, ctx),
    gatherSystemHealth(registry, userId, ctx),
    gatherHabits(registry, userId, ctx),
    gatherTasks(userId, now, ctx),
    gatherCalendar(userId, now, ctx),
    gatherRecentMemories(registry, userId, ctx),
    gatherUserLocation(registry, userId, ctx),
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

async function gatherHabits(
  _registry: ReturnType<typeof getServiceRegistry>,
  userId: string,
  ctx: PulseContext
): Promise<void> {
  try {
    const { createHabitsRepository } = await import('../db/repositories/habits.js');
    const habitsRepo = createHabitsRepository(userId);
    const progress = await habitsRepo.getTodayProgress();

    ctx.habits.todayHabits = progress.habits.map((h) => ({
      name: h.name,
      completed: h.completedToday,
      streak: h.streakCurrent,
    }));
    ctx.habits.todayProgress = progress.percentage;
  } catch (error) {
    log.debug('Failed to gather habits', { error: String(error) });
  }
}

async function gatherTasks(
  userId: string,
  now: Date,
  ctx: PulseContext
): Promise<void> {
  try {
    const { TasksRepository } = await import('../db/repositories/index.js');
    const tasksRepo = new TasksRepository(userId);
    const today = now.toISOString().split('T')[0] ?? '';
    const yesterday = new Date(now.getTime() - MS_PER_DAY).toISOString().split('T')[0] ?? '';

    const [dueToday, overdue] = await Promise.all([
      tasksRepo.list({
        status: ['pending', 'in_progress'],
        dueAfter: today,
        dueBefore: today,
        limit: 20,
      }),
      tasksRepo.list({
        status: ['pending', 'in_progress'],
        dueBefore: yesterday,
        limit: 20,
      }),
    ]);

    ctx.tasks.dueToday = dueToday.map((t) => ({
      title: t.title,
      priority: t.priority,
    }));
    ctx.tasks.overdue = overdue.map((t) => ({
      title: t.title,
      dueDate: t.dueDate ?? '',
    }));
  } catch (error) {
    log.debug('Failed to gather tasks', { error: String(error) });
  }
}

async function gatherCalendar(
  userId: string,
  _now: Date,
  ctx: PulseContext
): Promise<void> {
  try {
    const { CalendarRepository } = await import('../db/repositories/index.js');
    const calendarRepo = new CalendarRepository(userId);

    const [todayEvents, upcomingEvents] = await Promise.all([
      calendarRepo.getToday(),
      calendarRepo.getUpcoming(1), // Just tomorrow
    ]);

    ctx.calendar.todayEvents = todayEvents.map((e) => ({
      title: e.title,
      startTime: e.startTime ? e.startTime.toISOString() : '',
    }));

    // Filter upcoming to only tomorrow's events
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0] ?? '';
    ctx.calendar.tomorrowEvents = upcomingEvents
      .filter((e) => e.startTime && e.startTime.toISOString().startsWith(tomorrowStr))
      .map((e) => ({
        title: e.title,
        startTime: e.startTime ? e.startTime.toISOString() : '',
      }));
  } catch (error) {
    log.debug('Failed to gather calendar', { error: String(error) });
  }
}

async function gatherRecentMemories(
  registry: ReturnType<typeof getServiceRegistry>,
  userId: string,
  ctx: PulseContext
): Promise<void> {
  try {
    const memoryService = registry.get(Services.Memory);
    const memories = await memoryService.getImportantMemories(userId, {
      threshold: 0.5,
      limit: 10,
    });

    ctx.recentMemories = memories.map((m) => ({
      content: m.content,
      type: m.type,
      importance: m.importance,
    }));
  } catch (error) {
    log.debug('Failed to gather recent memories', { error: String(error) });
  }
}

async function gatherUserLocation(
  registry: ReturnType<typeof getServiceRegistry>,
  userId: string,
  ctx: PulseContext
): Promise<void> {
  try {
    const memoryService = registry.get(Services.Memory);
    const memories = await memoryService.searchMemories(userId, 'location city', { limit: 3 });
    const locationMemory = memories.find(
      (m) => m.type === 'preference' || m.content.toLowerCase().includes('location')
    );
    if (locationMemory) {
      ctx.userLocation = locationMemory.content;
    }
  } catch (error) {
    log.debug('Failed to gather user location', { error: String(error) });
  }
}
