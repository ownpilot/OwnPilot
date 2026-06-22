import { describe, expect, it } from 'vitest';
import type { ClawConfig, ClawSession } from '@ownpilot/core/services/claw';
import {
  buildHealthStatus,
  getHealthForConfig,
  scoreContract,
  serializeSession,
} from './health.js';

function config(overrides: Partial<ClawConfig> = {}): ClawConfig {
  return {
    id: 'claw-1',
    userId: 'default',
    name: 'Test Claw',
    mission: 'Do useful work',
    mode: 'interval',
    allowedTools: [],
    limits: {},
    autoStart: false,
    depth: 0,
    sandbox: 'auto',
    createdBy: 'user',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function session(overrides: Partial<ClawSession> = {}): ClawSession {
  const cfg = config({
    missionContract: {
      successCriteria: ['done'],
      deliverables: ['report'],
      constraints: ['safe'],
      evidenceRequired: true,
    },
    stopCondition: 'idle:3',
  });
  return {
    id: 'session-1',
    config: cfg,
    state: 'running',
    cyclesCompleted: 1,
    totalToolCalls: 1,
    totalCostUsd: 0,
    lastCycleAt: null,
    lastCycleDurationMs: null,
    lastCycleError: null,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    stoppedAt: null,
    artifacts: [],
    pendingEscalation: null,
    tasks: [],
    consecutiveErrors: 0,
    recentFailures: [],
    nextIntent: null,
    planHistory: [],
    ...overrides,
  };
}

describe('claw health helpers', () => {
  it('scores mission contracts from their safety and completion fields', () => {
    expect(scoreContract(config())).toBe(0);
    expect(
      scoreContract(
        config({
          stopCondition: 'idle:3',
          missionContract: {
            successCriteria: ['done'],
            deliverables: ['report'],
            constraints: ['safe'],
            evidenceRequired: true,
          },
        })
      )
    ).toBe(100);
  });

  it('flags weak event-mode claws without sessions as watch', () => {
    const health = buildHealthStatus(config({ mode: 'event', eventFilters: [] }), null);

    expect(health.status).toBe('watch');
    expect(health.signals).toContain('weak mission contract');
    expect(health.signals).toContain('event mode without filters');
    expect(health.recommendations[0]).toContain('Add success criteria');
  });

  it('treats orphan recovery as a soft restart signal', () => {
    const ses = session({ lastCycleError: 'orphan_recovery' });
    const health = buildHealthStatus(ses.config, ses);

    expect(health.status).toBe('healthy');
    expect(health.score).toBe(92);
    expect(health.signals).toContain('recovered from restart');
    expect(health.signals.some((signal) => signal.startsWith('last error:'))).toBe(false);
  });

  it('treats real last-cycle errors as watch', () => {
    const ses = session({ lastCycleError: 'OpenAI API error: 400' });
    const health = buildHealthStatus(ses.config, ses);

    expect(health.status).toBe('watch');
    expect(health.score).toBe(35);
    expect(health.signals[0]).toContain('last error: OpenAI API error');
  });

  it('serializes public session fields consistently', () => {
    const ses = session({ planHistory: undefined });
    const serialized = serializeSession(ses);

    expect(serialized).toEqual(
      expect.objectContaining({
        state: 'running',
        cyclesCompleted: 1,
        totalToolCalls: 1,
        totalCostUsd: 0,
        planHistory: [],
      })
    );
  });

  it('finds the matching session for a config', () => {
    const cfg = config({ id: 'target' });
    const matching = session({ config: cfg });

    expect(
      getHealthForConfig(cfg, [session({ config: config({ id: 'other' }) }), matching]).status
    ).toBe('watch');
  });
});
