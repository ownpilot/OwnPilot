import type { ClawState } from '../../api/endpoints/claws';

export function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  return fetch(url, { ...init, headers, credentials: init?.credentials ?? 'same-origin' });
}

export function getStateBadge(state: ClawState | null): { text: string; classes: string } {
  switch (state) {
    case 'running':
      return { text: 'Running', classes: 'bg-green-500/15 text-green-600 dark:text-green-400' };
    case 'paused':
      return { text: 'Paused', classes: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
    case 'starting':
      return { text: 'Starting', classes: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' };
    case 'waiting':
      return { text: 'Waiting', classes: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400' };
    case 'completed':
      return {
        text: 'Completed',
        classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
      };
    case 'failed':
      return { text: 'Failed', classes: 'bg-red-500/15 text-red-600 dark:text-red-400' };
    case 'stopped':
      return { text: 'Stopped', classes: 'bg-gray-500/15 text-gray-600 dark:text-gray-400' };
    case 'escalation_pending':
      return {
        text: 'Escalation',
        classes: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
      };
    default:
      return { text: 'Idle', classes: 'bg-gray-500/15 text-gray-500' };
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary';

export const labelClass =
  'block text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider mb-1';

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
