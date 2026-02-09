/**
 * Dashboard Service
 *
 * Aggregates data from all repositories for the daily briefing
 * and generates AI-powered summaries using LLM.
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
import { getServiceRegistry, Services, type IDatabaseService, type ServiceMemoryEntry } from '@ownpilot/core';
import { getLog } from './log.js';

const log = getLog('DashboardService');

// ============================================================================
// Types
// ============================================================================

export interface TasksSummary {
  pending: Task[];
  dueToday: Task[];
  overdue: Task[];
  counts: { pending: number; dueToday: number; overdue: number; total: number };
}

export interface CalendarSummary {
  todayEvents: CalendarEvent[];
  upcomingEvents: CalendarEvent[];
  counts: { today: number; upcoming: number };
}

export interface GoalsSummary {
  active: Goal[];
  nextActions: Array<GoalStep & { goalTitle: string }>;
  stats: { activeCount: number; averageProgress: number; overdueCount: number };
}

export interface TriggersSummary {
  scheduledToday: Trigger[];
  recentHistory: TriggerHistory[];
  counts: { enabled: number; scheduledToday: number };
}

export interface MemoriesSummary {
  recent: ServiceMemoryEntry[];
  important: ServiceMemoryEntry[];
  stats: { total: number; recentCount: number };
}

export interface HabitProgressItem {
  id: string;
  name: string;
  completedToday: boolean;
  streakCurrent: number;
}

export interface HabitProgress {
  completed: number;
  total: number;
  habits: HabitProgressItem[];
}

export interface HabitsSummary {
  todayProgress: HabitProgress;
  streaksAtRisk: HabitProgressItem[];
}

export interface NotesSummary {
  pinned: Note[];
  recent: Note[];
}

export interface CostSummaryData {
  totalTokens: number;
  totalCost: number;
  totalCalls: number;
}

export interface CostsSummary {
  daily: CostSummaryData;
  monthly: CostSummaryData;
}

export interface CustomTableSummaryItem {
  id: string;
  name: string;
  recordCount: number;
}

export interface CustomDataSummary {
  tables: CustomTableSummaryItem[];
  totalRecords: number;
}

export interface PlansSummary {
  running: Plan[];
  pendingApproval: Plan[];
}

export interface DailyBriefingData {
  tasks: TasksSummary;
  calendar: CalendarSummary;
  goals: GoalsSummary;
  triggers: TriggersSummary;
  memories: MemoriesSummary;
  habits: HabitsSummary;
  notes: NotesSummary;
  costs: CostsSummary;
  customData: CustomDataSummary;
  plans: PlansSummary;
  generatedAt: string;
}

export interface AIBriefing {
  id: string;
  summary: string;
  priorities: string[];
  insights: string[];
  suggestedFocusAreas: string[];
  generatedAt: string;
  expiresAt: string;
  modelUsed: string;
  cached: boolean;
}

export interface BriefingResponse {
  data: DailyBriefingData;
  aiBriefing: AIBriefing | null;
  error?: string;
}

// ============================================================================
// Cache Implementation with Smart Invalidation
// ============================================================================

interface CacheEntry {
  briefing: AIBriefing;
  dataHash: string;
  expiresAt: number;
}

/**
 * Calculate a hash/fingerprint of the data for smart cache invalidation
 * This changes when the underlying data changes significantly
 */
export function calculateDataHash(data: DailyBriefingData): string {
  const hashParts = [
    // Task counts
    `t:${data.tasks.counts.pending},${data.tasks.counts.dueToday},${data.tasks.counts.overdue}`,
    // Calendar count
    `c:${data.calendar.counts.today}`,
    // Goals stats
    `g:${data.goals.stats.activeCount},${Math.round(data.goals.stats.averageProgress)}`,
    // Habits progress
    `h:${data.habits.todayProgress.completed}/${data.habits.todayProgress.total}`,
    // Triggers count
    `tr:${data.triggers.counts.scheduledToday}`,
    // Plans count
    `p:${data.plans.running.length},${data.plans.pendingApproval.length}`,
  ];

  return hashParts.join('|');
}

class BriefingCache {
  private cache = new Map<string, CacheEntry>();
  private readonly DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_ENTRIES = 500;

  /**
   * Get cached briefing if valid (not expired and data hasn't changed)
   */
  get(userId: string, currentDataHash?: string): AIBriefing | null {
    const entry = this.cache.get(userId);
    if (!entry) return null;

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(userId);
      return null;
    }

    // Check if data has changed (smart invalidation)
    if (currentDataHash && entry.dataHash !== currentDataHash) {
      log.info('[BriefingCache] Data changed, invalidating cache');
      this.cache.delete(userId);
      return null;
    }

    return { ...entry.briefing, cached: true };
  }

  /**
   * Store briefing with data hash for smart invalidation
   */
  set(userId: string, briefing: AIBriefing, dataHash: string, ttlMs?: number): void {
    const ttl = ttlMs ?? this.DEFAULT_TTL_MS;
    this.cache.set(userId, {
      briefing,
      dataHash,
      expiresAt: Date.now() + ttl,
    });

    // Proactively prune expired entries to prevent unbounded growth
    if (this.cache.size > this.MAX_ENTRIES) {
      this.prune();
    }
  }

  /**
   * Remove expired entries
   */
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get the current data hash for a cached entry
   */
  getDataHash(userId: string): string | null {
    const entry = this.cache.get(userId);
    return entry?.dataHash ?? null;
  }

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const briefingCache = new BriefingCache();

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

    // Aggregate all data with graceful degradation per section
    // Each section is wrapped so a single data source failure doesn't crash the entire briefing

    // Tasks — use DB-side filtering instead of loading all into memory
    let pendingTasks: Task[] = [];
    let dueTodayTasks: Task[] = [];
    let overdueTasks: Task[] = [];
    let taskTotal = 0;
    try {
      const yesterday = new Date(Date.now() - MS_PER_DAY).toISOString().split('T')[0] ?? '';
      [pendingTasks, dueTodayTasks, overdueTasks] = await Promise.all([
        tasksRepo.list({ status: ['pending', 'in_progress'], limit: 50 }),
        tasksRepo.list({ status: ['pending', 'in_progress'], dueAfter: today, dueBefore: today, limit: 50 }),
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
      [allTriggers, triggerHistory] = await Promise.all([
        triggerService.listTriggers(this.userId, { limit: 100 }),
        triggerService.getRecentHistory(this.userId, 10),
      ]);
    } catch (err) {
      log.error('[DashboardService] Failed to load triggers:', err);
    }
    const enabledTriggers = allTriggers.filter(t => t.enabled);
    const scheduledToday = enabledTriggers.filter(t => {
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
    const streaksAtRisk = todayHabits.habits.filter((h: HabitProgressItem) => !h.completedToday && h.streakCurrent > 0);

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
    const runningPlans = allPlans.filter(p => p.status === 'running');
    const pendingApprovalPlans = allPlans.filter(p => p.status === 'pending');

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
        counts: {
          today: todayEvents.length,
          upcoming: upcomingEvents.length,
        },
      },
      goals: {
        active: activeGoals,
        nextActions,
        stats: goalStats,
      },
      triggers: {
        scheduledToday,
        recentHistory: triggerHistory,
        counts: {
          enabled: enabledTriggers.length,
          scheduledToday: scheduledToday.length,
        },
      },
      memories: {
        recent: recentMemories,
        important: importantMemories,
        stats: {
          total: memoryStats.total,
          recentCount: memoryStats.recentCount,
        },
      },
      habits: {
        todayProgress: todayHabits,
        streaksAtRisk,
      },
      notes: {
        pinned: pinnedNotes,
        recent: recentNotes,
      },
      costs: {
        daily: dailyCosts,
        monthly: monthlyCosts,
      },
      customData: customDataSummary,
      plans: {
        running: runningPlans,
        pendingApproval: pendingApprovalPlans,
      },
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
    // Calculate data hash for smart cache invalidation
    const dataHash = calculateDataHash(data);

    // Check cache first (unless force refresh)
    // Smart invalidation: cache is also invalid if data has changed
    if (!options?.forceRefresh) {
      const cached = briefingCache.get(this.userId, dataHash);
      if (cached) return cached;
    }

    // Build prompt for AI
    const prompt = this.buildBriefingPrompt(data);

    // Use a fast/cheap model for summaries — resolve from user settings
    const { getDefaultProvider, getDefaultModel } = await import('../routes/settings.js');
    const provider = options?.provider ?? await getDefaultProvider() ?? 'openai';
    const model = options?.model ?? await getDefaultModel(provider) ?? 'gpt-4o-mini';

    try {
      // Dynamic import to avoid circular dependency
      const { getOrCreateChatAgent } = await import('../routes/agents.js');
      const agent = await getOrCreateChatAgent(provider, model);
      const result = await agent.chat(prompt, { stream: false });

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      // Parse the AI response
      const briefing = this.parseAIResponse(result.value.content, model);

      // Cache the briefing with data hash
      briefingCache.set(this.userId, briefing, dataHash);

      return briefing;
    } catch (error) {
      log.error('[DashboardService] AI briefing generation failed:', error);

      // Return fallback briefing
      return this.generateFallbackBriefing(data);
    }
  }

  /**
   * Generate AI briefing with streaming support
   */
  async generateAIBriefingStreaming(
    data: DailyBriefingData,
    options: { provider: string; model: string },
    onChunk: (chunk: string) => Promise<void>
  ): Promise<AIBriefing> {
    // Calculate data hash for smart cache
    const dataHash = calculateDataHash(data);

    // Build prompt for AI
    const prompt = this.buildBriefingPrompt(data);

    try {
      // Dynamic import to avoid circular dependency
      const { getOrCreateChatAgent } = await import('../routes/agents.js');
      const agent = await getOrCreateChatAgent(options.provider, options.model);

      let fullContent = '';

      // Use streaming
      const result = await agent.chat(prompt, {
        stream: true,
        onChunk: (chunk) => {
          if (chunk.content) {
            fullContent += chunk.content;
            // Fire async callback but don't await (streaming shouldn't block)
            onChunk(chunk.content).catch(err =>
              log.error('[DashboardService] Chunk callback error:', err)
            );
          }
        },
      });

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      // Use the full content from streaming or result
      const content = fullContent || result.value.content;

      // Parse the AI response
      const briefing = this.parseAIResponse(content, options.model);

      // Cache the briefing with data hash
      briefingCache.set(this.userId, briefing, dataHash);

      return briefing;
    } catch (error) {
      log.error('[DashboardService] Streaming AI briefing failed:', error);

      // Return fallback briefing
      return this.generateFallbackBriefing(data);
    }
  }

  /**
   * Build the prompt for AI briefing generation
   */
  private buildBriefingPrompt(data: DailyBriefingData): string {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const tasksList = data.tasks.overdue.slice(0, 3).map(t => `  - [OVERDUE] ${t.title}`).join('\n') +
      (data.tasks.overdue.length > 0 ? '\n' : '') +
      data.tasks.dueToday.slice(0, 5).map(t => `  - ${t.title} (${t.priority} priority)`).join('\n');

    const eventsList = data.calendar.todayEvents.slice(0, 5).map(e => {
      const time = new Date(e.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return `  - ${time}: ${e.title}`;
    }).join('\n');

    const nextActionsList = data.goals.nextActions.slice(0, 3).map(a =>
      `  - Next: ${a.title} (for goal)`
    ).join('\n');

    const streaksAtRiskList = data.habits.streaksAtRisk.slice(0, 3).map(h =>
      `  - ${h.name} (${h.streakCurrent} day streak)`
    ).join('\n');

    return `You are a personal AI assistant generating a daily briefing for ${today}.

## Today's Data

### Tasks
- Overdue: ${data.tasks.counts.overdue} tasks
- Due Today: ${data.tasks.counts.dueToday} tasks
- Pending: ${data.tasks.counts.pending} tasks
${tasksList || '  (no tasks)'}

### Calendar
- ${data.calendar.counts.today} events today
${eventsList || '  (no events)'}

### Goals
- ${data.goals.stats.activeCount} active goals
- Average progress: ${Math.round(data.goals.stats.averageProgress)}%
- ${data.goals.stats.overdueCount} overdue goals
${nextActionsList || '  (no next actions)'}

### Habits
- Progress: ${data.habits.todayProgress.completed}/${data.habits.todayProgress.total} completed
- ${data.habits.streaksAtRisk.length} streaks at risk
${streaksAtRiskList || '  (no streaks at risk)'}

### AI Costs
- Today: $${data.costs.daily.totalCost.toFixed(2)} (${data.costs.daily.totalTokens.toLocaleString()} tokens)
- This month: $${data.costs.monthly.totalCost.toFixed(2)}

### Running Automations
- ${data.triggers.counts.scheduledToday} triggers scheduled for today
- ${data.plans.running.length} plans currently running

Generate a daily briefing with:
1. A natural language SUMMARY (2-3 sentences) of the day ahead
2. Top 3-5 PRIORITIES for today (ordered by importance)
3. 2-3 INSIGHTS or patterns you notice
4. 2-3 SUGGESTED FOCUS AREAS

Format your response as JSON:
{
  "summary": "...",
  "priorities": ["...", "..."],
  "insights": ["...", "..."],
  "suggestedFocusAreas": ["...", "..."]
}`;
  }

  /**
   * Parse AI response into structured briefing
   */
  private parseAIResponse(content: string, model: string): AIBriefing {
    try {
      // Strategy 1: Extract JSON from markdown code fences (```json ... ``` or ``` ... ```)
      const fenceMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      let jsonStr: string | undefined;

      if (fenceMatch) {
        jsonStr = fenceMatch[1];
      } else {
        // Strategy 2: Find the first complete top-level JSON object by brace balancing
        const startIdx = content.indexOf('{');
        if (startIdx !== -1) {
          let depth = 0;
          let inString = false;
          let escape = false;
          for (let i = startIdx; i < content.length; i++) {
            const ch = content[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"' && !escape) { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
              depth--;
              if (depth === 0) {
                jsonStr = content.slice(startIdx, i + 1);
                break;
              }
            }
          }
        }
      }

      if (!jsonStr) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonStr);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes

      return {
        id: `briefing_${Date.now()}`,
        summary: parsed.summary ?? 'No summary available.',
        priorities: Array.isArray(parsed.priorities) ? parsed.priorities : [],
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
        suggestedFocusAreas: Array.isArray(parsed.suggestedFocusAreas) ? parsed.suggestedFocusAreas : [],
        generatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        modelUsed: model,
        cached: false,
      };
    } catch (error) {
      log.error('[DashboardService] Failed to parse AI response:', error);
      throw error;
    }
  }

  /**
   * Generate fallback briefing when AI fails
   */
  private generateFallbackBriefing(data: DailyBriefingData): AIBriefing {
    const priorities: string[] = [];

    if (data.tasks.counts.overdue > 0) {
      priorities.push(`Address ${data.tasks.counts.overdue} overdue task(s)`);
    }
    if (data.tasks.counts.dueToday > 0) {
      priorities.push(`Complete ${data.tasks.counts.dueToday} task(s) due today`);
    }
    if (data.calendar.counts.today > 0) {
      priorities.push(`Attend ${data.calendar.counts.today} scheduled event(s)`);
    }
    if (data.habits.streaksAtRisk.length > 0) {
      priorities.push(`Maintain ${data.habits.streaksAtRisk.length} habit streak(s) at risk`);
    }

    return {
      id: `briefing_fallback_${Date.now()}`,
      summary: `Today you have ${data.tasks.counts.dueToday} tasks due, ${data.calendar.counts.today} events, and ${data.habits.todayProgress.total} habits to complete.`,
      priorities,
      insights: ['AI briefing generation is currently unavailable.'],
      suggestedFocusAreas: ['Complete your most urgent tasks first.'],
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes for fallback
      modelUsed: 'fallback',
      cached: false,
    };
  }

  /**
   * Calculate goal statistics
   */
  private calculateGoalStats(goals: Goal[]): { activeCount: number; averageProgress: number; overdueCount: number } {
    const today = new Date().toISOString().split('T')[0] ?? '';
    const overdueCount = goals.filter(g => g.dueDate && g.dueDate < today).length;
    const totalProgress = goals.reduce((sum, g) => sum + (g.progress ?? 0), 0);
    const averageProgress = goals.length > 0 ? totalProgress / goals.length : 0;

    return {
      activeCount: goals.length,
      averageProgress,
      overdueCount,
    };
  }

  /**
   * Get habit progress for today
   */
  private async getHabitProgress(repo: HabitsRepository): Promise<HabitProgress> {
    const progress = await repo.getTodayProgress();

    return {
      completed: progress.completed,
      total: progress.total,
      habits: progress.habits.map(h => ({
        id: h.id,
        name: h.name,
        completedToday: h.completedToday,
        streakCurrent: h.streakCurrent,
      })),
    };
  }

  /**
   * Get daily cost summary
   */
  private async getDailyCosts(repo: CostsRepository): Promise<CostSummaryData> {
    const dailyCosts = await repo.getDailyCosts(1);
    const today = dailyCosts[0];
    return {
      totalTokens: today?.totalTokens ?? 0,
      totalCost: today?.totalCost ?? 0,
      totalCalls: today?.totalCalls ?? 0,
    };
  }

  /**
   * Get monthly cost summary
   */
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

  /**
   * Get custom data summary
   */
  private async getCustomDataSummary(
    service: IDatabaseService,
    tables: CustomTableSchema[]
  ): Promise<CustomDataSummary> {
    const allStats = await Promise.all(
      tables.map((t) => service.getTableStats(t.id))
    );

    let totalRecords = 0;
    const tableSummaries: CustomTableSummaryItem[] = tables.map((t, i) => {
      const recordCount = allStats[i]?.recordCount ?? 0;
      totalRecords += recordCount;
      return { id: t.id, name: t.displayName, recordCount };
    });

    return {
      tables: tableSummaries,
      totalRecords,
    };
  }

  /**
   * Invalidate cached briefing
   */
  invalidateCache(): void {
    briefingCache.invalidate(this.userId);
  }
}
