/**
 * Tests for the claw-list derivations.
 *
 * This logic lived inline in ClawsPage.tsx as a chain of `claws.filter(...)`
 * calls in the component body, where it could only be exercised by rendering
 * the whole page. Extracted, it is directly testable — which matters, because
 * the filter has four independent modes and the attention buckets encode
 * thresholds an operator depends on.
 */

import { describe, it, expect } from 'vitest';
import type { ClawConfig } from '../../api/endpoints/claws';
import {
  filterClaws,
  countRunning,
  deriveAttention,
  REFLECT_THRESHOLD,
  STALL_THRESHOLD,
} from './derive';

function claw(over: Partial<ClawConfig> & { id: string }): ClawConfig {
  return {
    name: `claw-${over.id}`,
    mission: 'do a thing',
    mode: 'interval',
    ...over,
  } as ClawConfig;
}

const NO_FILTERS = { searchQuery: '', filterMode: '', filterState: '' };

describe('filterClaws', () => {
  const claws = [
    claw({ id: 'a', name: 'Nightly researcher', mission: 'summarise the feed' }),
    claw({ id: 'b', name: 'Builder', mission: 'compile things', mode: 'continuous' }),
  ];

  it('returns everything when no filter is set', () => {
    expect(filterClaws(claws, NO_FILTERS)).toHaveLength(2);
  });

  it('matches the search query against name, mission and id', () => {
    expect(filterClaws(claws, { ...NO_FILTERS, searchQuery: 'nightly' })).toHaveLength(1);
    expect(filterClaws(claws, { ...NO_FILTERS, searchQuery: 'compile' })).toHaveLength(1);
    expect(filterClaws(claws, { ...NO_FILTERS, searchQuery: 'a' }).map((c) => c.id)).toContain('a');
  });

  it('is case-insensitive', () => {
    expect(filterClaws(claws, { ...NO_FILTERS, searchQuery: 'NIGHTLY' })).toHaveLength(1);
  });

  it('filters by mode', () => {
    const out = filterClaws(claws, { ...NO_FILTERS, filterMode: 'continuous' });
    expect(out.map((c) => c.id)).toEqual(['b']);
  });

  describe('state filter', () => {
    const byState = [
      claw({ id: 'running', session: { state: 'running' } } as never),
      claw({ id: 'paused', session: { state: 'paused' } } as never),
      claw({ id: 'failed', session: { state: 'failed' } } as never),
      claw({ id: 'none' }),
    ];

    it('"active" covers running, starting and waiting', () => {
      expect(
        filterClaws(byState, { ...NO_FILTERS, filterState: 'active' }).map((c) => c.id)
      ).toEqual(['running']);
    });

    it('"paused" matches only paused', () => {
      expect(
        filterClaws(byState, { ...NO_FILTERS, filterState: 'paused' }).map((c) => c.id)
      ).toEqual(['paused']);
    });

    it('"stopped" covers stopped, completed, failed — and a claw with no session', () => {
      // A claw that has never run has no session and defaults to 'stopped'.
      const ids = filterClaws(byState, { ...NO_FILTERS, filterState: 'stopped' }).map((c) => c.id);
      expect(ids).toContain('failed');
      expect(ids).toContain('none');
      expect(ids).not.toContain('running');
    });

    it('"attention" filters on health, not session state', () => {
      const health = [
        claw({ id: 'ok', health: { status: 'healthy' } } as never),
        claw({ id: 'stuck', health: { status: 'stuck' } } as never),
        claw({ id: 'unset' }),
      ];
      const ids = filterClaws(health, { ...NO_FILTERS, filterState: 'attention' }).map((c) => c.id);
      expect(ids).toEqual(['stuck']);
    });
  });

  it('applies search and mode together', () => {
    const out = filterClaws(claws, {
      ...NO_FILTERS,
      searchQuery: 'builder',
      filterMode: 'interval',
    });
    expect(out).toHaveLength(0);
  });
});

describe('countRunning', () => {
  it('counts only active session states', () => {
    const claws = [
      claw({ id: '1', session: { state: 'running' } } as never),
      claw({ id: '2', session: { state: 'starting' } } as never),
      claw({ id: '3', session: { state: 'waiting' } } as never),
      claw({ id: '4', session: { state: 'paused' } } as never),
      claw({ id: '5' }),
    ];
    expect(countRunning(claws)).toBe(3);
  });

  it('is zero for an empty list', () => {
    expect(countRunning([])).toBe(0);
  });
});

describe('deriveAttention', () => {
  it('flags claws at or above the reflect threshold', () => {
    const claws = [
      claw({ id: 'below', session: { consecutiveErrors: REFLECT_THRESHOLD - 1 } } as never),
      claw({ id: 'at', session: { consecutiveErrors: REFLECT_THRESHOLD } } as never),
      claw({ id: 'none' }),
    ];
    expect(deriveAttention(claws).reflectClaws.map((c) => c.id)).toEqual(['at']);
  });

  it('flags a stalled in-progress task at or above the stall threshold', () => {
    const claws = [
      claw({
        id: 'stalled',
        session: { tasks: [{ status: 'in_progress', cyclesInProgress: STALL_THRESHOLD }] },
      } as never),
      claw({
        id: 'moving',
        session: { tasks: [{ status: 'in_progress', cyclesInProgress: 1 }] },
      } as never),
      // A finished task at high cycles is not a stall.
      claw({
        id: 'done',
        session: { tasks: [{ status: 'completed', cyclesInProgress: 99 }] },
      } as never),
      claw({ id: 'notasks', session: {} } as never),
    ];
    expect(deriveAttention(claws).stalledClaws.map((c) => c.id)).toEqual(['stalled']);
  });

  it('collects failed claws and operator-queued intents', () => {
    const claws = [
      claw({ id: 'failed', session: { state: 'failed' } } as never),
      claw({ id: 'queued', session: { nextIntent: '[OPERATOR] do this' } } as never),
      claw({ id: 'auto', session: { nextIntent: 'continue' } } as never),
    ];
    const { failedClaws, operatorQueuedClaws } = deriveAttention(claws);
    expect(failedClaws.map((c) => c.id)).toEqual(['failed']);
    expect(operatorQueuedClaws.map((c) => c.id)).toEqual(['queued']);
  });

  it('returns empty buckets for an empty list', () => {
    const out = deriveAttention([]);
    expect(out.reflectClaws).toEqual([]);
    expect(out.stalledClaws).toEqual([]);
    expect(out.failedClaws).toEqual([]);
    expect(out.operatorQueuedClaws).toEqual([]);
  });
});
