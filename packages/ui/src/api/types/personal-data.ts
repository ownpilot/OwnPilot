// Notes, Bookmarks, Contacts, Calendar, Goals, Memories, and Plans types

export interface Note {
  id: string;
  title: string;
  content: string;
  contentType: 'markdown' | 'text';
  category?: string;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Bookmarks ----

export interface BookmarkItem {
  id: string;
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  tags: string[];
  folder?: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Contacts ----

export interface Contact {
  id: string;
  name: string;
  nickname?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  avatar?: string;
  birthday?: string;
  address?: string;
  notes?: string;
  relationship?: string;
  tags: string[];
  isFavorite: boolean;
  socialLinks?: Record<string, string>;
  customFields?: Record<string, string>;
  lastContactedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Calendar ----

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  isAllDay: boolean;
  color?: string;
  reminders: string[];
  createdAt: string;
  updatedAt: string;
}

// ---- Goals ----

export interface GoalStep {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  orderNum: number;
  dependencies?: string[];
  result?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Goal {
  id: string;
  title: string;
  description?: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  priority: number;
  parentId?: string;
  dueDate?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  steps?: GoalStep[];
}

// ---- Memories ----

export interface Memory {
  id: string;
  type: 'fact' | 'preference' | 'conversation' | 'event';
  content: string;
  source?: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  metadata?: Record<string, unknown>;
}

// ---- Plans ----

export interface PlanStep {
  id: string;
  planId: string;
  type:
    | 'tool_call'
    | 'llm_decision'
    | 'user_input'
    | 'condition'
    | 'parallel'
    | 'loop'
    | 'sub_plan';
  name: string;
  description?: string;
  config: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked' | 'waiting';
  orderNum: number;
  dependencies: string[];
  result?: unknown;
  error?: string;
  retryCount: number;
  maxRetries: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface Plan {
  id: string;
  name: string;
  goal: string;
  description?: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  goalId?: string;
  triggerId?: string;
  progress: number;
  totalSteps: number;
  currentStep?: number;
  error?: string;
  checkpoint?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  steps?: PlanStep[];
}

export type PlanEventType =
  | 'started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'paused'
  | 'resumed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'checkpoint'
  | 'rollback';

export interface PlanHistoryEntry {
  id: string;
  planId: string;
  stepId: string | null;
  eventType: PlanEventType;
  details: Record<string, unknown>;
  createdAt: string;
}
