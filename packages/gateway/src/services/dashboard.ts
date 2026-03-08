/**
 * Dashboard Service
 *
 * Aggregates data from all repositories for the daily briefing
 * and generates AI-powered summaries using LLM.
 *
 * Implementation split:
 * - dashboard-types.ts:    All interfaces for briefing data model
 * - dashboard-briefing.ts: AI generation, cache, prompt, parsing
 * - dashboard.ts:          DashboardService class (this file)
 */

import { MS_PER_DAY } from '../config/defaults.js';
import {
  TasksRepository,
  CalendarRepository,
  HabitsRepository,
  CostsRepository,
  NotesRepository,
  type Task,
  type CalendarEvent,
  type Goal,
  type GoalStep,
  type Trigger,
  type TriggerHistory,
  type Note,
  type Plan,
} from '../db/repositories/index.js';
import { type CustomTableSchema } from '../db/repositories/custom-data.js';
import {
  getServiceRegistry,
  Services,
  type IDatabaseService,
  type ServiceMemoryEntry,
} from '@ownpilot/core';
import { getLog } from './log.js';

// Re-export types and briefing utilities for backward compatibility
export type {
  TasksSummary,
  CalendarSummary,
  GoalsSummary,
  TriggersSummary,
  MemoriesSummary,
  HabitProgressItem,
  HabitProgress,
  HabitsSummary,
  NotesSummary,
  CostSummaryData,
  CostsSummary,
  CustomTableSummaryItem,
  CustomDataSummary,
  PlansSummary,
  DailyBriefingData,
  AIBriefing,
  BriefingResponse,
} from './dashboard-types.js';
export {
  calculateDataHash,
  briefingCache,
  generateFallbackBriefing,
  parseAIResponse,
  buildBriefingPrompt,
} from './dashboard-briefing.js';

import type {
  DailyBriefingData,
  AIBriefing,
  HabitProgress,
  HabitProgressItem,
  CostSummaryData,
  CustomDataSummary,
  CustomTableSummaryItem,
} from './dashboard-types.js';
import {
  generateAIBriefing,
  generateAIBriefingStreaming,
  briefingCache,
} from './dashboard-briefing.js';

const log = getLog('DashboardService');

// ============================================================================
// Dashboard Service
// ============================================================================

export class DashboardService {
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  /**
   * Aggregate all data for the daily briefing
   */
  async aggregateDailyData(): Promise<DailyBriefingData> {
    const tasksRepo = new TasksRepository(this.userId);
    const calendarRepo = new CalendarRepository(this.userId);
    const registry = getServiceRegistry();
    const goalService = registry.get(Services.Goal);
    const triggerService = registry.get(Services.Trigger);
    const memoryService = registry.get(Services.Memory);
    const habitsRepo = new HabitsRepository(this.userId);
    const costsRepo = new CostsRepository();
    const notesRepo = new NotesRepository(this.userId);
    const customDataService = registry.get(Services.Database);
    const planService = registry.get(Services.Plan);

    const today = new Date().toISOString().split('T')[0] ?? '';

    // Each section is wrapped so a single data source failure doesn't crash the entire briefing

    // Tasks
    let pendingTasks: Task[] = [];
    let dueTodayTasks: Task[] = [];
    let overdueTasks: Task[] = [];
    let taskTotal = 0;
    try {
      const yesterday = new Date(Date.now() - MS_PER_DAY).toISOString().split('T')[0] ?? '';
      [pendingTasks, dueTodayTasks, overdueTasks] = await Promise.all([
        tasksRepo.list({ status: ['pending', 'in_progress'], limit: 50 }),
        tasksRepo.list({
          status: ['pending', 'in_progress'],
          dueAfter: today,
          dueBefore: today,
          limit: 50,
        }),
        tasksRepo.list({ status: ['pending', 'in_progress'], dueBefore: yesterday, limit: 50 }),
      ]);
      taskTotal = pendingTasks.length;
    } catch (err) {
      log.error('[DashboardService] Failed to load tasks:', err);
    }

    // Calendar
    let todayEvents: CalendarEvent[] = [];
    let upcomingEvents: CalendarEvent[] = [];
    try {
      [todayEvents, upcomingEvents] = await Promise.all([
        calendarRepo.getToday(),
        calendarRepo.getUpcoming(7),
      ]);
    } catch (err) {
      log.error('[DashboardService] Failed to load calendar:', err);
    }

    // Goals
    let activeGoals: Goal[] = [];
    let nextActions: Array<GoalStep & { goalTitle: string }> = [];
    try {
      [activeGoals, nextActions] = await Promise.all([
        goalService.getActive(this.userId, 10),
        goalService.getNextActions(this.userId, 5),
      ]);
    } catch (err) {
      log.error('[DashboardService] Failed to load goals:', err);
    }
    const goalStats = this.calculateGoalStats(activeGoals);

    // Triggers
    let allTriggers: Trigger[] = [];
    let triggerHistory: TriggerHistory[] = [];
    try {
      const [triggers, historyResult] = await Promise.all([
        triggerService.listTriggers(this.userId, { limit: 100 }),
        triggerService.getRecentHistory(this.userId, { limit: 10 }),
      ]);
      allTriggers = triggers;
      triggerHistory = historyResult.history;
    } catch (err) {
      log.error('[DashboardService] Failed to load triggers:', err);
    }
    const enabledTriggers = allTriggers.filter((t) => t.enabled);
    const scheduledToday = enabledTriggers.filter((t) => {
      if (!t.nextFire) return false;
      const fireDate = new Date(t.nextFire).toISOString().split('T')[0];
      return fireDate === today;
    });

    // Memories
    let recentMemories: ServiceMemoryEntry[] = [];
    let importantMemories: ServiceMemoryEntry[] = [];
    let memoryStats: { total: number; recentCount: number } = { total: 0, recentCount: 0 };
    try {
      [recentMemories, importantMemories, memoryStats] = await Promise.all([
        memoryService.getRecentMemories(this.userId, 10),
        memoryService.getImportantMemories(this.userId, { threshold: 0.7, limit: 5 }),
        memoryService.getStats(this.userId),
      ]);
    } catch (err) {
      log.error('[DashboardService] Failed to load memories:', err);
    }

    // Habits
    let todayHabits: HabitProgress = { completed: 0, total: 0, habits: [] };
    try {
      todayHabits = await this.getHabitProgress(habitsRepo);
    } catch (err) {
      log.error('[DashboardService] Failed to load habits:', err);
    }
    const streaksAtRisk = todayHabits.habits.filter(
      (h: HabitProgressItem) => !h.completedToday && h.streakCurrent > 0
    );

    // Notes
    let pinnedNotes: Note[] = [];
    let recentNotes: Note[] = [];
    try {
      [pinnedNotes, recentNotes] = await Promise.all([
        notesRepo.getPinned(),
        notesRepo.getRecent(5),
      ]);
    } catch (err) {
      log.error('[DashboardService] Failed to load notes:', err);
    }

    // Costs
    let dailyCosts: CostSummaryData = { totalTokens: 0, totalCost: 0, totalCalls: 0 };
    let monthlyCosts: CostSummaryData = { totalTokens: 0, totalCost: 0, totalCalls: 0 };
    try {
      [dailyCosts, monthlyCosts] = await Promise.all([
        this.getDailyCosts(costsRepo),
        this.getMonthlyCosts(costsRepo),
      ]);
    } catch (err) {
      log.error('[DashboardService] Failed to load costs:', err);
    }

    // Custom Data
    let customDataSummary: CustomDataSummary = { tables: [], totalRecords: 0 };
    try {
      const customTables = await customDataService.listTables();
      customDataSummary = await this.getCustomDataSummary(customDataService, customTables);
    } catch (err) {
      log.error('[DashboardService] Failed to load custom data:', err);
    }

    // Plans
    let allPlans: Plan[] = [];
    try {
      allPlans = await planService.listPlans(this.userId, { limit: 50 });
    } catch (err) {
      log.error('[DashboardService] Failed to load plans:', err);
    }
    const runningPlans = allPlans.filter((p) => p.status === 'running');
    const pendingApprovalPlans = allPlans.filter((p) => p.status === 'pending');

    return {
      tasks: {
        pending: pendingTasks.slice(0, 10),
        dueToday: dueTodayTasks,
        overdue: overdueTasks,
        counts: {
          pending: pendingTasks.length,
          dueToday: dueTodayTasks.length,
          overdue: overdueTasks.length,
          total: taskTotal,
        },
      },
      calendar: {
        todayEvents,
        upcomingEvents,
        counts: { today: todayEvents.length, upcoming: upcomingEvents.length },
      },
      goals: { active: activeGoals, nextActions, stats: goalStats },
      triggers: {
        scheduledToday,
        recentHistory: triggerHistory,
        counts: { enabled: enabledTriggers.length, scheduledToday: scheduledToday.length },
      },
      memories: {
        recent: recentMemories,
        important: importantMemories,
        stats: { total: memoryStats.total, recentCount: memoryStats.recentCount },
      },
      habits: { todayProgress: todayHabits, streaksAtRisk },
      notes: { pinned: pinnedNotes, recent: recentNotes },
      costs: { daily: dailyCosts, monthly: monthlyCosts },
      customData: customDataSummary,
      plans: { running: runningPlans, pendingApproval: pendingApprovalPlans },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate AI briefing from aggregated data
   */
  async generateAIBriefing(
    data: DailyBriefingData,
    options?: { forceRefresh?: boolean; provider?: string; model?: string }
  ): Promise<AIBriefing> {
    return generateAIBriefing(this.userId, data, options);
  }

  /**
   * Generate AI briefing with streaming support
   */
  async generateAIBriefingStreaming(
    data: DailyBriefingData,
    options: { provider: string; model?: string },
    onChunk: (chunk: string) => Promise<void>
  ): Promise<AIBriefing> {
    return generateAIBriefingStreaming(this.userId, data, options, onChunk);
  }

  private calculateGoalStats(goals: Goal[]) {
    const today = new Date().toISOString().split('T')[0] ?? '';
    const overdueCount = goals.filter((g) => g.dueDate && g.dueDate < today).length;
    const totalProgress = goals.reduce((sum, g) => sum + (g.progress ?? 0), 0);
    const averageProgress = goals.length > 0 ? totalProgress / goals.length : 0;
    return { activeCount: goals.length, averageProgress, overdueCount };
  }

  private async getHabitProgress(repo: HabitsRepository): Promise<HabitProgress> {
    const progress = await repo.getTodayProgress();
    return {
      completed: progress.completed,
      total: progress.total,
      habits: progress.habits.map((h) => ({
        id: h.id,
        name: h.name,
        completedToday: h.completedToday,
        streakCurrent: h.streakCurrent,
      })),
    };
  }

  private async getDailyCosts(repo: CostsRepository): Promise<CostSummaryData> {
    const dailyCosts = await repo.getDailyCosts(1);
    const today = dailyCosts[0];
    return {
      totalTokens: today?.totalTokens ?? 0,
      totalCost: today?.totalCost ?? 0,
      totalCalls: today?.totalCalls ?? 0,
    };
  }

  private async getMonthlyCosts(repo: CostsRepository): Promise<CostSummaryData> {
    const monthlyCosts = await repo.getDailyCosts(30);
    return monthlyCosts.reduce(
      (acc, day) => ({
        totalTokens: acc.totalTokens + day.totalTokens,
        totalCost: acc.totalCost + day.totalCost,
        totalCalls: acc.totalCalls + day.totalCalls,
      }),
      { totalTokens: 0, totalCost: 0, totalCalls: 0 }
    );
  }

  private async getCustomDataSummary(
    service: IDatabaseService,
    tables: CustomTableSchema[]
  ): Promise<CustomDataSummary> {
    const allStats = await Promise.all(tables.map((t) => service.getTableStats(t.id)));
    let totalRecords = 0;
    const tableSummaries: CustomTableSummaryItem[] = tables.map((t, i) => {
      const recordCount = allStats[i]?.recordCount ?? 0;
      totalRecords += recordCount;
      return { id: t.id, name: t.displayName, recordCount };
    });
    return { tables: tableSummaries, totalRecords };
  }

  invalidateCache(): void {
    briefingCache.invalidate(this.userId);
  }
}
