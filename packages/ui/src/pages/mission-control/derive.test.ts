/**
 * Tests for Mission Control's fleet ordering, filtering and activity feed.
 *
 * This is the triage logic for the whole autonomous fleet: it decides which
 * claw an operator sees first. The cases below pin the priority order, the
 * stall detection (a claw stuck on one task still reports `running`, so nothing
 * else would flag it), and the agreement between the `attention` filter and the
 * sort. All of it was inline in MissionControlPage.tsx and reachable only by
 * rendering the page.
 */

import { describe, it, expect } from 'vitest';
import {
  attentionScore,
  matchesFilter,
  matchesSearch,
  selectVisibleClaws,
  buildActivityFeed,
  selectEscalations,
  REFLECT_THRESHOLD,
  STALL_THRESHOLD,
  ACTIVITY_FEED_LIMIT,
} from './derive';
import type { ClawConfig } from '../../api';

function claw(id: string, session?: Record<string, unknown>): ClawConfig {
  return { id, name: id, session } as unknown as ClawConfig;
}

const task = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  status: 'in_progress',
  ...over,
});

describe('attentionScore', () => {
  it('ranks an escalation above everything else', () => {
    expect(attentionScore(claw('a', { state: 'escalation_pending' }))).toBe(0);
  });

  it('ranks repeated errors above a plain failure', () => {
    const erroring = attentionScore(
      claw('a', { state: 'running', consecutiveErrors: REFLECT_THRESHOLD })
    );
    const failed = attentionScore(claw('b', { state: 'failed' }));
    expect(erroring).toBeLessThan(failed);
  });

  it('does not flag an error count below the reflect threshold', () => {
    const c = claw('a', { state: 'running', consecutiveErrors: REFLECT_THRESHOLD - 1 });
    expect(attentionScore(c)).toBeGreaterThan(3);
  });

  it('flags a task stuck for too many cycles even though the claw looks healthy', () => {
    // The state is still 'running' — cyclesInProgress is the only signal.
    const stalled = claw('a', {
      state: 'running',
      tasks: [task({ cyclesInProgress: STALL_THRESHOLD })],
    });
    expect(attentionScore(stalled)).toBe(3);
    expect(attentionScore(claw('b', { state: 'running' }))).toBe(4);
  });

  it('ignores cycles spent on tasks that are not in progress', () => {
    const c = claw('a', {
      state: 'running',
      tasks: [task({ status: 'completed', cyclesInProgress: 99 })],
    });
    expect(attentionScore(c)).toBe(4);
  });

  it('ranks idle and unknown claws last', () => {
    expect(attentionScore(claw('a'))).toBe(6);
    expect(attentionScore(claw('b', { state: 'paused' }))).toBe(5);
  });

  it('produces a strictly increasing order across the priority bands', () => {
    const bands = [
      claw('esc', { state: 'escalation_pending' }),
      claw('err', { state: 'running', consecutiveErrors: REFLECT_THRESHOLD }),
      claw('fail', { state: 'failed' }),
      claw('stall', { state: 'running', tasks: [task({ cyclesInProgress: STALL_THRESHOLD })] }),
      claw('run', { state: 'running' }),
      claw('paused', { state: 'paused' }),
      claw('idle'),
    ].map(attentionScore);
    expect(bands).toEqual([...bands].sort((a, b) => a - b));
    expect(new Set(bands).size).toBe(bands.length);
  });
});

describe('matchesFilter', () => {
  it('passes everything through the "all" filter', () => {
    expect(matchesFilter(claw('a'), 'all')).toBe(true);
  });

  it('treats starting and waiting as running', () => {
    for (const state of ['running', 'starting', 'waiting']) {
      expect(matchesFilter(claw('a', { state }), 'running'), state).toBe(true);
    }
    expect(matchesFilter(claw('a', { state: 'paused' }), 'running')).toBe(false);
  });

  it('defaults a session-less claw to stopped', () => {
    expect(matchesFilter(claw('a'), 'running')).toBe(false);
    expect(matchesFilter(claw('a'), 'paused')).toBe(false);
  });

  it('selects exactly the claws the sort puts first', () => {
    // The filter is defined in terms of attentionScore; this pins that contract.
    const fleet = [
      claw('esc', { state: 'escalation_pending' }),
      claw('stall', { state: 'running', tasks: [task({ cyclesInProgress: STALL_THRESHOLD })] }),
      claw('run', { state: 'running' }),
      claw('idle'),
    ];
    const flagged = fleet.filter((c) => matchesFilter(c, 'attention')).map((c) => c.id);
    expect(flagged).toEqual(['esc', 'stall']);
  });
});

describe('matchesSearch', () => {
  it('matches all claws for a blank query', () => {
    expect(matchesSearch(claw('a'), '   ')).toBe(true);
  });

  it('matches on name case-insensitively and on id', () => {
    const c = { id: 'claw-abc', name: 'Nightly Researcher' } as ClawConfig;
    expect(matchesSearch(c, 'nightly')).toBe(true);
    expect(matchesSearch(c, 'abc')).toBe(true);
    expect(matchesSearch(c, 'weekly')).toBe(false);
  });
});

describe('selectVisibleClaws', () => {
  it('filters, searches and sorts by attention in one pass', () => {
    const fleet = [
      claw('idle-one'),
      claw('esc-one', { state: 'escalation_pending' }),
      claw('run-one', { state: 'running' }),
    ];
    expect(selectVisibleClaws(fleet, 'all', '').map((c) => c.id)).toEqual([
      'esc-one',
      'run-one',
      'idle-one',
    ]);
  });

  it('does not mutate the input array', () => {
    const fleet = [claw('b', { state: 'running' }), claw('a', { state: 'escalation_pending' })];
    const before = fleet.map((c) => c.id);
    selectVisibleClaws(fleet, 'all', '');
    expect(fleet.map((c) => c.id)).toEqual(before);
  });

  it('applies the search on top of the filter', () => {
    const fleet = [
      claw('esc-one', { state: 'escalation_pending' }),
      claw('esc-two', { state: 'escalation_pending' }),
    ];
    expect(selectVisibleClaws(fleet, 'escalation', 'two').map((c) => c.id)).toEqual(['esc-two']);
  });
});

describe('buildActivityFeed', () => {
  const entry = (at: string) => ({ at, summary: at }) as never;

  it('merges history across claws, newest first', () => {
    const feed = buildActivityFeed([
      claw('a', { planHistory: [entry('2026-08-01T00:00:00Z')] }),
      claw('b', { planHistory: [entry('2026-08-03T00:00:00Z')] }),
      claw('c', { planHistory: [entry('2026-08-02T00:00:00Z')] }),
    ]);
    expect(feed.map((f) => f.claw.id)).toEqual(['b', 'c', 'a']);
  });

  it('tags each entry with its source claw', () => {
    const feed = buildActivityFeed([claw('a', { planHistory: [entry('2026-08-01T00:00:00Z')] })]);
    expect(feed[0]!.claw.id).toBe('a');
    expect(feed[0]!.at).toBe('2026-08-01T00:00:00Z');
  });

  it('caps the feed so one chatty claw cannot crowd out the fleet', () => {
    const noisy = claw('loud', {
      planHistory: Array.from({ length: ACTIVITY_FEED_LIMIT + 20 }, (_, i) =>
        entry(`2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`)
      ),
    });
    expect(buildActivityFeed([noisy])).toHaveLength(ACTIVITY_FEED_LIMIT);
  });

  it('is empty when no claw has any history', () => {
    expect(buildActivityFeed([claw('a'), claw('b', { planHistory: [] })])).toEqual([]);
  });
});

describe('selectEscalations', () => {
  it('requires both the pending state and an escalation payload', () => {
    const fleet = [
      claw('ok', { state: 'escalation_pending', pendingEscalation: { reason: 'x' } }),
      // State without payload: the card would render nothing, so it is excluded.
      claw('no-payload', { state: 'escalation_pending' }),
      claw('payload-only', { state: 'running', pendingEscalation: { reason: 'x' } }),
    ];
    expect(selectEscalations(fleet).map((c) => c.id)).toEqual(['ok']);
  });
});
