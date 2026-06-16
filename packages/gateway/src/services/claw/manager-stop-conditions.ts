/**
 * Claw Manager — Stop condition evaluation
 *
 * Pure function extracted from manager.ts: determines whether a claw
 * should terminate based on its cycle result and configuration.
 */

import type { ClawCycleResult } from '@ownpilot/core/services/claw';
import type { ManagedClaw } from './manager-types.js';

const MISSION_COMPLETE_SENTINEL = 'MISSION_COMPLETE';

/**
 * Evaluate whether a claw should stop after a cycle.
 *
 * Checks:
 * - MISSION_COMPLETE sentinel in output
 * - max_cycles:N — stop after N cycles
 * - on_report — stop when claw_complete_report was called
 * - on_error — stop on first cycle failure
 * - idle:N — stop after N consecutive idle cycles (0 tool calls)
 * - plan_complete — stop when all tasks are terminal (completed/blocked)
 *   AND at least one is completed
 */
export function shouldStop(managed: ManagedClaw, result: ClawCycleResult): boolean {
  // Check for MISSION_COMPLETE sentinel
  if (result.outputMessage.includes(MISSION_COMPLETE_SENTINEL)) {
    return true;
  }

  // Check stop condition
  const stopCondition = managed.session.config.stopCondition;
  if (!stopCondition) return false;

  // max_cycles:N — stop after N cycles
  const maxCyclesMatch = stopCondition.match(/^max_cycles:(\d+)$/i);
  if (maxCyclesMatch?.[1]) {
    const maxCycles = parseInt(maxCyclesMatch[1], 10);
    if (managed.session.cyclesCompleted >= maxCycles) {
      return true;
    }
  }

  // on_report — stop when claw_complete_report was called this cycle
  if (stopCondition === 'on_report') {
    const calledReport = result.toolCalls.some(
      (tc) => tc.tool === 'claw_complete_report' && tc.success
    );
    if (calledReport) return true;
  }

  // on_error — stop on first cycle failure
  if (stopCondition === 'on_error' && !result.success) {
    return true;
  }

  // idle:N — stop after N consecutive cycles with 0 tool calls
  const idleMatch = stopCondition.match(/^idle:(\d+)$/i);
  if (idleMatch?.[1]) {
    const idleLimit = parseInt(idleMatch[1], 10);
    if (managed.lastCycleToolCalls === 0) {
      managed.idleCycles = (managed.idleCycles ?? 0) + 1;
      if (managed.idleCycles >= idleLimit) return true;
    } else {
      managed.idleCycles = 0;
    }
  }

  // plan_complete — stop when every structured task is in a terminal
  // state (completed or blocked) AND at least one is completed. The
  // "at least one completed" guard prevents two degenerate exits: an
  // empty plan immediately tripping the stop on cycle 1, and a plan
  // where everything is blocked from being mistaken for success — that
  // is stuck, not done.
  if (stopCondition === 'plan_complete') {
    const tasks = managed.session.tasks;
    if (tasks.length > 0) {
      const everyTerminal = tasks.every((t) => t.status === 'completed' || t.status === 'blocked');
      const anyCompleted = tasks.some((t) => t.status === 'completed');
      if (everyTerminal && anyCompleted) return true;
    }
  }

  return false;
}
