/**
 * Tests for manager-task-plan.ts — task/plan persistence helpers.
 *
 * Pure functions that serialize/deserialize claw tasks and plan history
 * to/from persistentContext. No mocks needed.
 */

import { describe, it, expect } from 'vitest';
import {
  extractSavedTasks,
  extractSavedPlanHistory,
  stripSavedTasks,
  PRIORITY_DELAY_MULTIPLIER,
} from './manager-task-plan.js';
import type { ClawTask, ClawPlanHistoryEntry } from '@ownpilot/core/services/claw';

describe('manager-task-plan', () => {
  describe('PRIORITY_DELAY_MULTIPLIER', () => {
    it('has priority 1 = 0.5x (fastest)', () => {
      expect(PRIORITY_DELAY_MULTIPLIER[1]).toBe(0.5);
    });
    it('has priority 3 = 1.0x (normal)', () => {
      expect(PRIORITY_DELAY_MULTIPLIER[3]).toBe(1.0);
    });
    it('has priority 5 = 2.0x (slowest)', () => {
      expect(PRIORITY_DELAY_MULTIPLIER[5]).toBe(2.0);
    });
  });

  describe('extractSavedTasks', () => {
    it('returns empty array for undefined context', () => {
      expect(extractSavedTasks(undefined)).toEqual([]);
    });

    it('returns empty array when key is missing', () => {
      expect(extractSavedTasks({ foo: 'bar' })).toEqual([]);
    });

    it('extracts valid tasks', () => {
      const tasks: ClawTask[] = [
        { id: 't1', title: 'Task 1', status: 'pending' },
        { id: 't2', title: 'Task 2', status: 'completed' },
      ];
      const ctx = { __claw_tasks: tasks };
      expect(extractSavedTasks(ctx)).toEqual(tasks);
    });

    it('filters out malformed entries (missing required fields)', () => {
      const ctx = {
        __claw_tasks: [
          { id: 't1', title: 'Good', status: 'pending' },
          { id: 't2', title: 'Missing status' }, // no status
          { title: 'Missing id', status: 'pending' }, // no id
          'not an object',
          null,
        ],
      };
      const result = extractSavedTasks(ctx);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('t1');
    });
  });

  describe('extractSavedPlanHistory', () => {
    it('returns empty array for undefined context', () => {
      expect(extractSavedPlanHistory(undefined)).toEqual([]);
    });

    it('extracts valid history entries', () => {
      const entries: ClawPlanHistoryEntry[] = [
        { at: '2026-01-01', actor: 'agent', kind: 'replace', newTaskCount: 3 },
        { at: '2026-01-02', actor: 'operator', kind: 'task_update', taskId: 't1' },
      ];
      const ctx = { __claw_plan_history: entries };
      expect(extractSavedPlanHistory(ctx)).toEqual(entries);
    });

    it('filters out malformed entries', () => {
      const ctx = {
        __claw_plan_history: [
          { at: '2026-01-01', actor: 'agent', kind: 'replace' },
          { at: '2026-01-02', actor: 'agent' }, // missing kind
          null,
          'string',
        ],
      };
      const result = extractSavedPlanHistory(ctx);
      expect(result).toHaveLength(1);
    });
  });

  describe('stripSavedTasks', () => {
    it('removes __claw_tasks and __claw_plan_history keys', () => {
      const ctx = {
        foo: 'bar',
        __claw_tasks: [],
        __claw_plan_history: [],
      };
      const result = stripSavedTasks(ctx);
      expect(result).toEqual({ foo: 'bar' });
    });

    it('returns same object when no internal keys present', () => {
      const ctx = { foo: 'bar', baz: 42 };
      const result = stripSavedTasks(ctx);
      expect(result).toBe(ctx); // same reference — no copy needed
    });

    it('does not mutate the original context', () => {
      const ctx = { foo: 'bar', __claw_tasks: [1, 2] };
      stripSavedTasks(ctx);
      expect(ctx).toHaveProperty('__claw_tasks');
    });
  });
});
