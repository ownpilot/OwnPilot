/**
 * Ordering, filtering and feed assembly for Mission Control.
 *
 * These decide what an operator sees first across the whole fleet, so their
 * edge cases matter: a claw that has stalled mid-task but still reports
 * `running` must outrank a healthy running claw, and the "attention" filter
 * must agree with the ordering rather than drift from it. Extracted from
 * MissionControlPage.tsx (1109 LOC), where they were reachable only by
 * rendering the page.
 */

import type { ClawConfig, ClawPlanHistoryEntry } from '../../api';

// Mirrors backend thresholds.
export const REFLECT_THRESHOLD = 2;
export const STALL_THRESHOLD = 5;

/** How many activity entries the unified feed keeps, across all claws. */
export const ACTIVITY_FEED_LIMIT = 30;

export type FleetFilter = 'all' | 'attention' | 'running' | 'paused' | 'failed' | 'escalation';

/**
 * Sort key for the fleet grid — lower sorts first. 0-3 are the states an
 * operator is expected to act on, and are exactly what the `attention` filter
 * selects.
 */
export function attentionScore(c: ClawConfig): number {
  if (c.session?.state === 'escalation_pending') return 0;
  if ((c.session?.consecutiveErrors ?? 0) >= REFLECT_THRESHOLD) return 1;
  if (c.session?.state === 'failed') return 2;
  const focus = c.session?.tasks?.find((t) => t.status === 'in_progress');
  if (focus && (focus.cyclesInProgress ?? 0) >= STALL_THRESHOLD) return 3;
  if (c.session?.state === 'running' || c.session?.state === 'starting') return 4;
  if (c.session?.state === 'waiting' || c.session?.state === 'paused') return 5;
  return 6;
}

export function matchesFilter(claw: ClawConfig, filter: FleetFilter): boolean {
  const s = claw.session?.state ?? 'stopped';
  if (filter === 'all') return true;
  if (filter === 'running') return s === 'running' || s === 'starting' || s === 'waiting';
  if (filter === 'paused') return s === 'paused';
  if (filter === 'failed') return s === 'failed';
  if (filter === 'escalation') return s === 'escalation_pending';
  // Kept in terms of attentionScore so the filter cannot drift from the sort.
  if (filter === 'attention') return attentionScore(claw) <= 3;
  return true;
}

/** Name/id substring match, case-insensitive. An empty query matches all. */
export function matchesSearch(claw: ClawConfig, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return claw.name.toLowerCase().includes(q) || claw.id.includes(q);
}

/** Filter + search + attention sort, as the fleet grid renders it. */
export function selectVisibleClaws(
  claws: ClawConfig[],
  filter: FleetFilter,
  search: string
): ClawConfig[] {
  return [...claws]
    .filter((c) => matchesFilter(c, filter))
    .filter((c) => matchesSearch(c, search))
    .sort((a, b) => attentionScore(a) - attentionScore(b));
}

export interface ActivityEntry {
  claw: ClawConfig;
  entry: ClawPlanHistoryEntry;
  at: string;
}

/**
 * Unified newest-first timeline of plan-history entries across every claw,
 * capped so one chatty claw cannot crowd out the rest of the fleet.
 */
export function buildActivityFeed(
  claws: ClawConfig[],
  limit = ACTIVITY_FEED_LIMIT
): ActivityEntry[] {
  const all: ActivityEntry[] = [];
  for (const c of claws) {
    for (const e of c.session?.planHistory ?? []) {
      all.push({ claw: c, entry: e, at: e.at });
    }
  }
  all.sort((a, b) => (a.at < b.at ? 1 : -1));
  return all.slice(0, limit);
}

/** Claws sitting on an escalation that has not been answered yet. */
export function selectEscalations(claws: ClawConfig[]): ClawConfig[] {
  return claws.filter(
    (c) => c.session?.state === 'escalation_pending' && c.session.pendingEscalation
  );
}
