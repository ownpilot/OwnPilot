/**
 * Dashboard Types
 *
 * All interfaces for the daily briefing data model.
 */

import type {
  Task,
  CalendarEvent,
  Goal,
  GoalStep,
  Trigger,
  TriggerHistory,
  Note,
  Plan,
} from '../db/repositories/index.js';
import type { ServiceMemoryEntry } from '@ownpilot/core';

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
