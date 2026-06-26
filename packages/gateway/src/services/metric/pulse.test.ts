import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClawCycleSummary } from '@ownpilot/core/agent';

const eventHandlers = vi.hoisted(() => new Map<string, Set<(event: unknown) => void>>());

const mockEventSystem = vi.hoisted(() => ({
  on: vi.fn((eventName: string, handler: (event: unknown) => void) => {
    const handlers = eventHandlers.get(eventName) ?? new Set<(event: unknown) => void>();
    handlers.add(handler);
    eventHandlers.set(eventName, handlers);
  }),
  off: vi.fn((eventName: string, handler: (event: unknown) => void) => {
    eventHandlers.get(eventName)?.delete(handler);
  }),
}));

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@ownpilot/core/events', () => ({
  getEventSystem: () => mockEventSystem,
}));

vi.mock('../log.js', () => ({
  getLog: () => mockLog,
}));

import { PulseMetricsService } from './pulse.js';

function emit(eventName: string, payload: unknown): void {
  for (const handler of eventHandlers.get(eventName) ?? []) {
    handler({ payload });
  }
}

function cycleSummary(overrides: Partial<ClawCycleSummary> = {}): ClawCycleSummary {
  return {
    clawId: 'claw-1',
    cycleNumber: 1,
    success: true,
    durationMs: 1200,
    costUsd: 0.12,
    toolCallsCount: 2,
    consecutiveErrors: 0,
    totalCostUsd: 0.12,
    state: 'running',
    ...overrides,
  };
}

describe('PulseMetricsService', () => {
  beforeEach(() => {
    eventHandlers.clear();
    mockEventSystem.on.mockClear();
    mockEventSystem.off.mockClear();
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
    mockLog.debug.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to claw lifecycle events and unregisters handlers on stop', () => {
    const service = new PulseMetricsService();

    service.start();
    service.start();

    expect(mockEventSystem.on).toHaveBeenCalledTimes(3);

    emit('claw.started', { clawId: 'claw-1' });
    expect(service.getPulseClawStatusById('claw-1')).not.toBeNull();

    emit('claw.stopped', { clawId: 'claw-1' });
    expect(service.getPulseClawStatusById('claw-1')).toBeNull();

    service.stop();
    expect(mockEventSystem.off).toHaveBeenCalledTimes(3);
  });

  it('records cycle summaries and keeps lastCycleAt tied to the recorded cycle time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));

    const service = new PulseMetricsService();
    service.start();

    emit('claw.cycle.summary', cycleSummary());

    const status = service.getPulseClawStatusById('claw-1');
    expect(status).toMatchObject({
      clawId: 'claw-1',
      state: 'running',
      circuitState: 'closed',
      consecutiveErrors: 0,
      avgCycleDurationMs: 1200,
      avgCycleCost: 0.12,
      totalCostUsd: 0.12,
      cyclesCompleted: 1,
      circuitFailureCount: 0,
      nextRetryAt: null,
    });
    expect(status?.lastCycleAt).toEqual(new Date('2026-01-01T10:00:00.000Z'));

    vi.setSystemTime(new Date('2026-01-01T10:05:00.000Z'));
    expect(service.getPulseClawStatusById('claw-1')?.lastCycleAt).toEqual(
      new Date('2026-01-01T10:00:00.000Z')
    );
  });

  it('opens the claw circuit after repeated failed cycles', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));

    const service = new PulseMetricsService();
    service.start();

    for (let cycleNumber = 1; cycleNumber <= 5; cycleNumber += 1) {
      emit(
        'claw.cycle.summary',
        cycleSummary({
          cycleNumber,
          success: false,
          consecutiveErrors: cycleNumber,
          costUsd: 0,
          totalCostUsd: 0,
          error: `cycle-${cycleNumber}-failed`,
        })
      );
    }

    const status = service.getPulseClawStatusById('claw-1');
    expect(status).toMatchObject({
      circuitState: 'open',
      consecutiveErrors: 5,
      circuitFailureCount: 5,
      cyclesCompleted: 5,
      lastCycleError: 'cycle-5-failed',
    });
    expect(status?.nextRetryAt).toBe(new Date('2026-01-01T10:01:00.000Z').getTime());
  });
});
