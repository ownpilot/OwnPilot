import { describe, it, expect } from 'vitest';
import { shouldStop } from './manager-stop-conditions.js';
import type { ManagedClaw } from './manager-types.js';
import type { ClawCycleResult } from '@ownpilot/core/services/claw';

const makeResult = (over: Partial<ClawCycleResult> = {}): ClawCycleResult =>
  ({
    cycleIndex: 1,
    success: true,
    outputMessage: '',
    toolCalls: [],
    ...over,
  }) as ClawCycleResult;

const makeManaged = (
  over: {
    cyclesCompleted?: number;
    stopCondition?: string;
    tasks?: Array<{ status: string }>;
  } = {}
): ManagedClaw =>
  ({
    session: {
      id: 'claw-1',
      config: { name: 'TestClaw', stopCondition: over.stopCondition },
      cyclesCompleted: over.cyclesCompleted ?? 0,
      tasks: (over.tasks ?? []) as ManagedClaw['session']['tasks'],
      recentFailures: [],
      planHistory: [],
      inbox: [],
    },
  }) as ManagedClaw;

describe('shouldStop', () => {
  it('returns false when no stop condition is set', () => {
    const managed = makeManaged({ stopCondition: undefined });
    const result = makeResult({ outputMessage: 'some output' });
    expect(shouldStop(managed, result)).toBe(false);
  });

  it('returns true when output contains MISSION_COMPLETE sentinel', () => {
    const managed = makeManaged();
    const result = makeResult({ outputMessage: 'All done! MISSION_COMPLETE' });
    expect(shouldStop(managed, result)).toBe(true);
  });

  it('returns false when output contains MISSION_COMPLETE in a word (not sentinel)', () => {
    const managed = makeManaged();
    const result = makeResult({ outputMessage: 'The mission is complete and successful.' });
    // Must be exact token "MISSION_COMPLETE"
    expect(shouldStop(managed, result)).toBe(false);
  });

  describe('max_cycles:N', () => {
    it('returns false when cyclesCompleted < N', () => {
      const managed = makeManaged({ stopCondition: 'max_cycles:5', cyclesCompleted: 3 });
      const result = makeResult();
      expect(shouldStop(managed, result)).toBe(false);
    });

    it('returns true when cyclesCompleted >= N', () => {
      const managed = makeManaged({ stopCondition: 'max_cycles:5', cyclesCompleted: 5 });
      const result = makeResult();
      expect(shouldStop(managed, result)).toBe(true);
    });

    it('is case-insensitive', () => {
      const managed = makeManaged({ stopCondition: 'MAX_CYCLES:3', cyclesCompleted: 3 });
      const result = makeResult();
      expect(shouldStop(managed, result)).toBe(true);
    });
  });

  describe('on_report', () => {
    it('returns false when claw_complete_report was not called', () => {
      const managed = makeManaged({ stopCondition: 'on_report' });
      const result = makeResult({ toolCalls: [] });
      expect(shouldStop(managed, result)).toBe(false);
    });

    it('returns true when claw_complete_report was called and succeeded', () => {
      const managed = makeManaged({ stopCondition: 'on_report' });
      const result = makeResult({
        toolCalls: [
          {
            id: 'tc1',
            tool: 'claw_complete_report',
            success: true,
            args: {},
            result: 'ok',
            durationMs: 10,
          },
        ],
      });
      expect(shouldStop(managed, result)).toBe(true);
    });

    it('returns false when claw_complete_report failed', () => {
      const managed = makeManaged({ stopCondition: 'on_report' });
      const result = makeResult({
        toolCalls: [
          {
            id: 'tc1',
            tool: 'claw_complete_report',
            success: false,
            args: {},
            result: 'err',
            durationMs: 10,
          },
        ],
      });
      expect(shouldStop(managed, result)).toBe(false);
    });
  });

  describe('on_error', () => {
    it('returns false when cycle succeeded', () => {
      const managed = makeManaged({ stopCondition: 'on_error' });
      const result = makeResult({ success: true });
      expect(shouldStop(managed, result)).toBe(false);
    });

    it('returns true when cycle failed', () => {
      const managed = makeManaged({ stopCondition: 'on_error' });
      const result = makeResult({ success: false });
      expect(shouldStop(managed, result)).toBe(true);
    });
  });

  describe('idle:N', () => {
    it('returns false when cycle had tool calls', () => {
      const managed = makeManaged({ stopCondition: 'idle:3' }) as ManagedClaw & {
        lastCycleToolCalls: number;
        idleCycles?: number;
      };
      managed.lastCycleToolCalls = 1;
      const result = makeResult({
        toolCalls: [
          { id: 'tc1', tool: 'read_file', success: true, args: {}, result: 'ok', durationMs: 10 },
        ],
      });
      expect(shouldStop(managed, result)).toBe(false);
    });

    it('returns true when consecutive idle cycles reach limit', () => {
      const managed = makeManaged({ stopCondition: 'idle:2' }) as ManagedClaw & {
        lastCycleToolCalls: number;
        idleCycles: number;
      };
      managed.lastCycleToolCalls = 0;
      managed.idleCycles = 2;
      const result = makeResult({ toolCalls: [] });
      expect(shouldStop(managed, result)).toBe(true);
    });

    it('resets idle counter when cycle had tool calls', () => {
      // idleLimit=3, idleCycles=1 before call; lastCycleToolCalls=1 → resets idleCycles to 0
      const managed = makeManaged({ stopCondition: 'idle:3' }) as ManagedClaw & {
        lastCycleToolCalls: number;
        idleCycles: number;
      };
      managed.lastCycleToolCalls = 1;
      managed.idleCycles = 1;
      const result = makeResult({
        toolCalls: [
          { id: 'tc1', tool: 'read_file', success: true, args: {}, result: 'ok', durationMs: 10 },
        ],
      });
      const stop = shouldStop(managed, result);
      expect(stop).toBe(false);
      expect(managed.idleCycles).toBe(0); // reset to 0 since there were tool calls
    });
  });

  describe('plan_complete', () => {
    it('returns false when no tasks are terminal', () => {
      const managed = makeManaged({
        stopCondition: 'plan_complete',
        tasks: [{ status: 'in_progress' }, { status: 'pending' }],
      });
      const result = makeResult();
      expect(shouldStop(managed, result)).toBe(false);
    });

    it('returns false when all tasks are terminal but none completed', () => {
      const managed = makeManaged({
        stopCondition: 'plan_complete',
        tasks: [{ status: 'blocked' }, { status: 'skipped' }],
      });
      const result = makeResult();
      expect(shouldStop(managed, result)).toBe(false);
    });

    it('returns true when all tasks are terminal and at least one completed', () => {
      const managed = makeManaged({
        stopCondition: 'plan_complete',
        tasks: [{ status: 'completed' }, { status: 'blocked' }],
      });
      const result = makeResult();
      expect(shouldStop(managed, result)).toBe(true);
    });

    it('returns true when all tasks are completed', () => {
      const managed = makeManaged({
        stopCondition: 'plan_complete',
        tasks: [{ status: 'completed' }, { status: 'completed' }],
      });
      const result = makeResult();
      expect(shouldStop(managed, result)).toBe(true);
    });
  });

  describe('unknown stop condition', () => {
    it('returns false', () => {
      const managed = makeManaged({ stopCondition: 'unknown_condition' });
      const result = makeResult();
      expect(shouldStop(managed, result)).toBe(false);
    });
  });
});
