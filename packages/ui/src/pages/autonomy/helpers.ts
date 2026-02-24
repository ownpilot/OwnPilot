import type { RuleThresholds, ActionCooldowns, PulseDirectives } from '../../api';

export const PAGE_SIZE = 15;

export const levelColors = ['bg-error', 'bg-warning', 'bg-warning', 'bg-success', 'bg-primary'];

export const riskColors = {
  low: 'text-success',
  medium: 'text-warning',
  high: 'text-warning',
  critical: 'text-error',
};

export const DEFAULT_THRESHOLDS: RuleThresholds = {
  staleDays: 3,
  deadlineDays: 3,
  activityDays: 2,
  lowProgressPct: 10,
  memoryMaxCount: 500,
  memoryMinImportance: 0.3,
  triggerErrorMin: 3,
};

export const DEFAULT_COOLDOWNS: ActionCooldowns = {
  create_memory: 30,
  update_goal_progress: 60,
  send_notification: 15,
  run_memory_cleanup: 360,
};

export const DIRECTIVE_TEMPLATES: Record<string, Omit<PulseDirectives, 'template'>> = {
  conservative: {
    disabledRules: ['memory_cleanup', 'no_activity'],
    blockedActions: ['run_memory_cleanup'],
    customInstructions:
      'Only take action on critical signals. Prefer notifications over data modifications. Be very conservative.',
    ruleThresholds: { ...DEFAULT_THRESHOLDS, staleDays: 5, deadlineDays: 2 },
    actionCooldowns: { ...DEFAULT_COOLDOWNS, create_memory: 60, run_memory_cleanup: 720 },
  },
  balanced: {
    disabledRules: [],
    blockedActions: [],
    customInstructions: '',
    ruleThresholds: { ...DEFAULT_THRESHOLDS },
    actionCooldowns: { ...DEFAULT_COOLDOWNS },
  },
  proactive: {
    disabledRules: [],
    blockedActions: [],
    customInstructions:
      'Actively manage goals and memories. Send notifications about any progress opportunities. Create memories for patterns you notice.',
    ruleThresholds: { ...DEFAULT_THRESHOLDS, staleDays: 2, deadlineDays: 5, lowProgressPct: 20 },
    actionCooldowns: { ...DEFAULT_COOLDOWNS, create_memory: 15, send_notification: 5 },
  },
  minimal: {
    disabledRules: ['no_activity', 'memory_cleanup', 'low_progress'],
    blockedActions: ['run_memory_cleanup', 'create_memory'],
    customInstructions:
      'Only monitor deadlines and system health. Do not create or modify data. Only send high-urgency notifications.',
    ruleThresholds: { ...DEFAULT_THRESHOLDS },
    actionCooldowns: { ...DEFAULT_COOLDOWNS },
  },
};

export const THRESHOLD_LABELS: Record<
  string,
  { label: string; unit: string; min: number; max: number }
> = {
  staleDays: { label: 'Stale', unit: 'days', min: 1, max: 30 },
  deadlineDays: { label: 'Deadline', unit: 'days', min: 1, max: 30 },
  activityDays: { label: 'Activity', unit: 'days', min: 1, max: 30 },
  lowProgressPct: { label: 'Progress', unit: '%', min: 1, max: 100 },
  memoryMaxCount: { label: 'Max', unit: 'count', min: 50, max: 10000 },
  memoryMinImportance: { label: 'Min', unit: 'imp', min: 0, max: 1 },
  triggerErrorMin: { label: 'Errors', unit: 'min', min: 1, max: 100 },
};

export function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
