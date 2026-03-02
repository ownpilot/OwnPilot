/**
 * Autonomous Hub — shared helpers
 */

import type { AgentStatus } from './types';

// =============================================================================
// Status colors & labels
// =============================================================================

export const STATUS_COLORS: Record<AgentStatus, string> = {
  running: 'bg-green-500',
  starting: 'bg-yellow-500',
  waiting: 'bg-yellow-500',
  paused: 'bg-blue-500',
  idle: 'bg-gray-400 dark:bg-gray-600',
  stopped: 'bg-gray-400 dark:bg-gray-600',
  error: 'bg-red-500',
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  running: 'Running',
  starting: 'Starting',
  waiting: 'Waiting',
  paused: 'Paused',
  idle: 'Idle',
  stopped: 'Stopped',
  error: 'Error',
};

export const STATUS_TEXT_COLORS: Record<AgentStatus, string> = {
  running: 'text-green-600 dark:text-green-400',
  starting: 'text-yellow-600 dark:text-yellow-400',
  waiting: 'text-yellow-600 dark:text-yellow-400',
  paused: 'text-blue-600 dark:text-blue-400',
  idle: 'text-gray-500 dark:text-gray-400',
  stopped: 'text-gray-500 dark:text-gray-400',
  error: 'text-red-600 dark:text-red-400',
};

// =============================================================================
// Time formatting
// =============================================================================

export function formatTimeAgo(dateStr: string | undefined | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// =============================================================================
// Cron to human-readable
// =============================================================================

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function cronToHuman(cron: string): string {
  if (!cron) return 'Not scheduled';
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;

  // Length already checked above — safe to assert
  const minute = parts[0]!;
  const hour = parts[1]!;
  const dow = parts[4]!;

  // */N * * * * → Every N minutes
  if (minute.startsWith('*/') && hour === '*') {
    return `Every ${minute.slice(2)} minutes`;
  }

  // 0 */N * * * → Every N hours
  if (minute === '0' && hour.startsWith('*/')) {
    const n = parseInt(hour.slice(2), 10);
    return n === 1 ? 'Every hour' : `Every ${n} hours`;
  }

  // Specific times with day-of-week
  if (dow !== '*' && hour !== '*' && minute !== '*') {
    const timeStr = formatCronTime(minute, hour);
    const days = dow
      .split(',')
      .map((d) => DAY_NAMES[parseInt(d, 10)] ?? d)
      .join(', ');
    return `${days} at ${timeStr}`;
  }

  // Multiple times per day: 0 9,13,18 * * *
  if (hour.includes(',') && minute !== '*') {
    const times = hour.split(',').map((h) => formatCronTime(minute, h));
    return `Daily at ${times.join(', ')}`;
  }

  // Daily at specific time: 0 9 * * *
  if (hour !== '*' && minute !== '*' && dow === '*') {
    return `Daily at ${formatCronTime(minute, hour)}`;
  }

  return cron;
}

function formatCronTime(minute: string, hour: string): string {
  const h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// =============================================================================
// Coordination pattern labels
// =============================================================================

export const PATTERN_LABELS: Record<string, string> = {
  hub_spoke: 'Hub & Spoke',
  peer_to_peer: 'Peer to Peer',
  pipeline: 'Pipeline',
  hierarchical: 'Hierarchical',
  broadcast: 'Broadcast',
};

// =============================================================================
// Message type colors
// =============================================================================

export const MESSAGE_TYPE_COLORS: Record<string, string> = {
  coordination: 'bg-primary/10 text-primary',
  task_delegation: 'bg-warning/10 text-warning',
  task_result: 'bg-success/10 text-success',
  question: 'bg-primary/10 text-primary',
  feedback: 'bg-text-muted/10 text-text-muted',
  alert: 'bg-danger/10 text-danger',
  knowledge_share: 'bg-success/10 text-success',
};

export const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-danger',
  high: 'text-warning',
  normal: 'text-text-primary dark:text-dark-text-primary',
  low: 'text-text-muted dark:text-dark-text-muted',
};
