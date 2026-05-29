import { describe, expect, it } from 'vitest';
import type { ClawConfig } from '../api';
import { summarizeFleetAttention, listFleetAttention } from './FleetStatusIndicator';

function makeClaw(
  id: string,
  overrides: Partial<ClawConfig['session']> = {} as Partial<ClawConfig['session']>
): ClawConfig {
  const base = {
    state: 'running',
    cyclesCompleted: 1,
    totalToolCalls: 0,
    totalCostUsd: 0,
    lastCycleAt: null,
    lastCycleDurationMs: null,
    lastCycleError: null,
    startedAt: 't',
    stoppedAt: null,
    artifacts: [],
    pendingEscalation: null,
    tasks: [],
    consecutiveErrors: 0,
    recentFailures: [],
    planHistory: [],
  };
  return {
    id,
    userId: 'u',
    name: id,
    mission: 'm',
    mode: 'continuous',
    allowedTools: [],
    limits: {
      maxTurnsPerCycle: 10,
      maxToolCallsPerCycle: 30,
      maxCyclesPerHour: 60,
      cycleTimeoutMs: 60_000,
    },
    autoStart: false,
    depth: 0,
    sandbox: 'auto',
    createdBy: 'user',
    createdAt: 't',
    updatedAt: 't',
    session: { ...base, ...(overrides as object) } as ClawConfig['session'],
  };
}

describe('summarizeFleetAttention', () => {
  it('returns all zeros for an empty fleet', () => {
    expect(summarizeFleetAttention([])).toEqual({
      escalation: 0,
      reflection: 0,
      stalled: 0,
      failed: 0,
      total: 0,
    });
  });

  it('treats escalation_pending as the highest priority — never double-counted', () => {
    const claw = makeClaw('c1', {
      state: 'escalation_pending',
      // Would otherwise count for reflection too — must not.
      consecutiveErrors: 5,
    });
    const b = summarizeFleetAttention([claw]);
    expect(b.escalation).toBe(1);
    expect(b.reflection).toBe(0);
    expect(b.total).toBe(1);
  });

  it('counts reflection when consecutiveErrors >= threshold and not escalating', () => {
    const claw = makeClaw('c1', { state: 'running', consecutiveErrors: 2 });
    const b = summarizeFleetAttention([claw]);
    expect(b.reflection).toBe(1);
    expect(b.total).toBe(1);
  });

  it('counts failed terminal state', () => {
    const b = summarizeFleetAttention([makeClaw('c1', { state: 'failed' })]);
    expect(b.failed).toBe(1);
    expect(b.total).toBe(1);
  });

  it('counts stalled when focus task cyclesInProgress crosses threshold', () => {
    const claw = makeClaw('c1', {
      state: 'running',
      tasks: [
        {
          id: 't1',
          title: 'stuck thing',
          status: 'in_progress',
          cyclesInProgress: 5,
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    const b = summarizeFleetAttention([claw]);
    expect(b.stalled).toBe(1);
    expect(b.total).toBe(1);
  });

  it('ignores healthy running and idle claws', () => {
    const fleet = [
      makeClaw('healthy-1', { state: 'running', consecutiveErrors: 0 }),
      makeClaw('healthy-2', { state: 'waiting', consecutiveErrors: 0 }),
      makeClaw('idle-1', { state: 'stopped', consecutiveErrors: 0 }),
    ];
    expect(summarizeFleetAttention(fleet).total).toBe(0);
  });

  it('aggregates a mixed fleet correctly', () => {
    const fleet = [
      makeClaw('e1', { state: 'escalation_pending' }),
      makeClaw('e2', { state: 'escalation_pending' }),
      makeClaw('r1', { state: 'running', consecutiveErrors: 3 }),
      makeClaw('f1', { state: 'failed' }),
      makeClaw('s1', {
        state: 'running',
        tasks: [
          {
            id: 't',
            title: 'x',
            status: 'in_progress',
            cyclesInProgress: 7,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
      }),
      makeClaw('ok', { state: 'running' }),
    ];
    const b = summarizeFleetAttention(fleet);
    expect(b).toEqual({ escalation: 2, reflection: 1, stalled: 1, failed: 1, total: 5 });
  });

  it('handles claws with no session safely', () => {
    const claw = { ...makeClaw('c1'), session: null };
    const b = summarizeFleetAttention([claw]);
    expect(b.total).toBe(0);
  });
});

describe('listFleetAttention', () => {
  it('returns an entry per attention claw, sorted escalation → reflection → stalled → failed', () => {
    const fleet = [
      // Intentionally out of priority order in the input.
      makeClaw('f1', { state: 'failed', lastCycleError: 'boom' }),
      makeClaw('s1', {
        state: 'running',
        tasks: [
          {
            id: 't',
            title: 'long stuck thing',
            status: 'in_progress',
            cyclesInProgress: 7,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
      }),
      makeClaw('r1', { state: 'running', consecutiveErrors: 3 }),
      makeClaw('e1', {
        state: 'escalation_pending',
        pendingEscalation: {
          id: 'esc-1',
          type: 'approval',
          reason: 'deploy needs sign-off',
          requestedAt: 't',
        },
      }),
      makeClaw('ok', { state: 'running' }),
    ];
    const out = listFleetAttention(fleet);
    expect(out.map((e) => e.reason)).toEqual(['escalation', 'reflection', 'stalled', 'failed']);
    expect(out.map((e) => e.claw.id)).toEqual(['e1', 'r1', 's1', 'f1']);
  });

  it('escalation entry detail prefers pendingEscalation.reason', () => {
    const fleet = [
      makeClaw('e1', {
        state: 'escalation_pending',
        pendingEscalation: {
          id: 'esc',
          type: 'approval',
          reason: 'needs production approval from on-call',
          requestedAt: 't',
        },
      }),
    ];
    expect(listFleetAttention(fleet)[0]?.detail).toContain('production approval');
  });

  it('reflection entry surfaces the error count', () => {
    const fleet = [makeClaw('r1', { state: 'running', consecutiveErrors: 4 })];
    expect(listFleetAttention(fleet)[0]?.detail).toBe('4 consecutive errors');
  });

  it('stalled entry surfaces the task title and cycles count', () => {
    const fleet = [
      makeClaw('s1', {
        state: 'running',
        tasks: [
          {
            id: 't',
            title: 'fix the flaky auth test',
            status: 'in_progress',
            cyclesInProgress: 8,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
      }),
    ];
    const detail = listFleetAttention(fleet)[0]?.detail ?? '';
    expect(detail).toContain('8c');
    expect(detail).toContain('fix the flaky auth test');
  });

  it('returns empty for a healthy fleet', () => {
    expect(listFleetAttention([makeClaw('ok', { state: 'running' })])).toEqual([]);
  });
});
