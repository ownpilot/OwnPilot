/**
 * Analytics formatting and palette.
 *
 * Split out of AnalyticsPage.tsx (1058 LOC). Pure values and pure functions —
 * shared by the page and its chart primitives.
 */

export const CHART_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#64748b',
];

export const STATE_COLORS: Record<string, string> = {
  running: '#22c55e',
  paused: '#eab308',
  stopped: '#64748b',
  failed: '#ef4444',
  completed: '#6366f1',
  waiting: '#06b6d4',
  starting: '#3b82f6',
  escalation_pending: '#a855f7',
};

export function fmtCost(val: number): string {
  if (val >= 1) return `$${val.toFixed(2)}`;
  if (val >= 0.01) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(4)}`;
}

export function fmtTokens(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(val);
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
