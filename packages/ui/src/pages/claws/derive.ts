/**
 * Pure derivations over the claw list.
 *
 * Split out of ClawsPage.tsx. These were inline `claws.filter(...)` chains in
 * the component body, re-evaluated on every render and untestable in isolation.
 * They depend on nothing but their arguments.
 */

import type { ClawConfig } from '../../api/endpoints/claws';

/** Consecutive errors at or above this count means the claw needs reflection. */
export const REFLECT_THRESHOLD = 2;
/** Cycles a single in-progress task may burn before it counts as stalled. */
export const STALL_THRESHOLD = 5;

const ACTIVE_STATES = ['running', 'starting', 'waiting'];
const STOPPED_STATES = ['stopped', 'completed', 'failed'];
const ATTENTION_HEALTH = ['watch', 'stuck', 'expensive', 'failed'];

export interface ClawFilters {
  searchQuery: string;
  filterMode: string;
  filterState: string;
}

export function filterClaws(claws: ClawConfig[], filters: ClawFilters): ClawConfig[] {
  const { searchQuery, filterMode, filterState } = filters;
  return claws.filter((c) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !c.name.toLowerCase().includes(q) &&
        !c.mission.toLowerCase().includes(q) &&
        !c.id.toLowerCase().includes(q)
      )
        return false;
    }
    if (filterMode && c.mode !== filterMode) return false;
    if (filterState) {
      const state = c.session?.state ?? 'stopped';
      if (filterState === 'active' && !ACTIVE_STATES.includes(state)) return false;
      if (filterState === 'attention' && !ATTENTION_HEALTH.includes(c.health?.status ?? 'healthy'))
        return false;
      if (filterState === 'stopped' && !STOPPED_STATES.includes(state)) return false;
      if (filterState === 'paused' && state !== 'paused') return false;
    }
    return true;
  });
}

export function countRunning(claws: ClawConfig[]): number {
  return claws.filter((c) => c.session && ACTIVE_STATES.includes(c.session.state)).length;
}

/**
 * Attention buckets surfaced at page level so an operator sees them without
 * drilling into individual claws.
 */
export function deriveAttention(claws: ClawConfig[]): {
  reflectClaws: ClawConfig[];
  stalledClaws: ClawConfig[];
  failedClaws: ClawConfig[];
  operatorQueuedClaws: ClawConfig[];
} {
  return {
    reflectClaws: claws.filter((c) => (c.session?.consecutiveErrors ?? 0) >= REFLECT_THRESHOLD),
    stalledClaws: claws.filter((c) => {
      if (!c.session?.tasks) return false;
      const focus = c.session.tasks.find((t) => t.status === 'in_progress');
      return focus !== undefined && (focus.cyclesInProgress ?? 0) >= STALL_THRESHOLD;
    }),
    failedClaws: claws.filter((c) => c.session?.state === 'failed'),
    operatorQueuedClaws: claws.filter((c) => c.session?.nextIntent?.startsWith('[OPERATOR] ')),
  };
}
