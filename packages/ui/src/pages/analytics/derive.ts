/**
 * Chart-series derivations for the analytics dashboard.
 *
 * These were inline transforms in the AnalyticsPage body, re-evaluated on every
 * render and only reachable by rendering the whole page. They are pure
 * functions of their arguments, and each encodes a decision worth pinning: the
 * top-N caps, the "cost > 0" and "requests > 0" filters, and the rounding used
 * for money and token counts.
 */

import type { ProviderBreakdown, DailyUsage } from '../../api';
import type { SummaryData } from '../../types';
import { shortDate } from './format';

/** The costs-breakdown shape AnalyticsPage holds in state. */
export interface CostsBreakdown {
  byProvider: ProviderBreakdown[];
  byModel: ProviderBreakdown[];
  daily: DailyUsage[];
  totalCost: number;
}

/** Cost/token series keyed by short date, for the area and bar charts. */
export function toDailySeries(breakdown: CostsBreakdown | null | undefined) {
  return (breakdown?.daily ?? []).map((d) => ({
    ...d,
    date: shortDate(d.date),
    tokens: d.inputTokens + d.outputTokens,
  }));
}

/** Spend per provider, cents-rounded, excluding providers that cost nothing. */
export function toProviderDonut(breakdown: CostsBreakdown | null | undefined) {
  return (breakdown?.byProvider ?? [])
    .filter((p) => p.cost > 0)
    .map((p) => ({ name: p.provider, value: Math.round(p.cost * 100) / 100 }));
}

/** Request volume per provider — capped at 8 so the bar chart stays readable. */
export function toProviderRequests(breakdown: CostsBreakdown | null | undefined) {
  return (breakdown?.byProvider ?? [])
    .filter((p) => p.requests > 0)
    .slice(0, 8)
    .map((p) => ({
      name: p.provider,
      requests: p.requests,
      input: p.inputTokens,
      output: p.outputTokens,
    }));
}

/**
 * Spend per model — capped at 6. Cost keeps four decimals because per-model
 * spend is often well under a cent.
 */
export function toModelCostSeries(breakdown: CostsBreakdown | null | undefined) {
  return ((breakdown?.byModel ?? []) as Array<ProviderBreakdown & { model?: string }>)
    .filter((m) => m.cost > 0)
    .slice(0, 6)
    .map((m) => ({
      name: m.model ?? m.provider,
      cost: Math.round(m.cost * 10000) / 10000,
      requests: m.requests,
    }));
}

/** `{ running: 2, idle: 0 }` -> `[{ name: 'running', value: 2 }]`, zeroes dropped. */
export function toCountSeries(counts: Record<string, number> | undefined) {
  if (!counts) return [];
  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, value: v }));
}

export function toAgentBars(counts: { souls: number; claws: number; workflows: number }) {
  return [
    { name: 'Soul Agents', count: counts.souls, fill: '#6366f1' },
    { name: 'Claws', count: counts.claws, fill: '#ec4899' },
    { name: 'Workflows', count: counts.workflows, fill: '#22c55e' },
  ];
}

/** Task completion for the radial gauge. Null when there is no summary yet. */
export function toTaskProgress(summary: SummaryData | null | undefined) {
  if (!summary) return null;
  const { completed, pending, overdue, total } = summary.tasks;
  return {
    completed,
    pending,
    overdue,
    total,
    // Guard the divide: a fresh install has no tasks at all.
    pct: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}
