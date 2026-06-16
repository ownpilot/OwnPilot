/**
 * Claw Manager — Post-cycle escalation & stall detection
 *
 * Extracted from manager.ts executeCycle: the three post-cycle policy
 * enforcement blocks that run after a successful cycle and before
 * scheduling the next one:
 *
 * 1. Budget threshold enforcement (autonomyPolicy.maxCostUsdBeforePause)
 * 2. Task force-block (CLAW_TASK_STALL_FORCE_BLOCK)
 * 3. Task auto-escalation (CLAW_TASK_STALL_AUTO_ESCALATE)
 *
 * Each returns true if it triggered an escalation (caller should return
 * early, skipping the remaining cycle-ops), or false to continue.
 */

import { generateId } from '@ownpilot/core/services';
import {
  CLAW_TASK_STALL_AUTO_ESCALATE,
  CLAW_TASK_STALL_FORCE_BLOCK,
} from '@ownpilot/core/services/claw';
import type { ClawEscalation, ClawPlanHistoryEntry } from '@ownpilot/core/services/claw';
import { getLog } from '../log.js';
import { getClawsRepository } from '../../db/repositories/claws.js';
import type { ManagedClaw } from './manager-types.js';

const log = getLog('ClawManager');

/**
 * Callbacks the escalation ops need from the manager.
 * This decouples the circular dependency without passing the full class.
 */
export interface CycleOpsCallbacks {
  requestEscalation: (clawId: string, escalation: ClawEscalation) => Promise<void>;
  recordPlanHistory: (managed: ManagedClaw, entry: ClawPlanHistoryEntry) => void;
  markDirty: (managed: ManagedClaw) => void;
  emitPlanUpdated: (
    clawId: string,
    managed: ManagedClaw,
    source: 'replace' | 'task',
    taskId?: string
  ) => void;
}

/**
 * Check and enforce autonomy budget threshold.
 * Returns true if a budget_increase escalation was triggered.
 */
export async function checkBudgetThreshold(
  clawId: string,
  managed: ManagedClaw,
  cb: CycleOpsCallbacks
): Promise<boolean> {
  const policyMaxCost = managed.session.config.autonomyPolicy?.maxCostUsdBeforePause;
  if (
    policyMaxCost !== undefined &&
    managed.session.totalCostUsd >= policyMaxCost &&
    managed.session.state !== 'escalation_pending' &&
    !managed.session.pendingEscalation
  ) {
    log.warn(
      `[${clawId}] autonomyPolicy.maxCostUsdBeforePause reached ($${managed.session.totalCostUsd.toFixed(4)} >= $${policyMaxCost}); requesting budget_increase escalation`
    );
    try {
      await cb.requestEscalation(clawId, {
        id: generateId('esc'),
        type: 'budget_increase',
        reason: `Total cost $${managed.session.totalCostUsd.toFixed(4)} reached autonomy-policy threshold $${policyMaxCost}`,
        details: {
          totalCostUsd: managed.session.totalCostUsd,
          maxCostUsdBeforePause: policyMaxCost,
          cyclesCompleted: managed.session.cyclesCompleted,
          autoTriggered: true,
        },
        requestedAt: new Date(),
      });
    } catch (err) {
      log.warn(
        `[${clawId}] Failed to auto-request escalation: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return true;
  }
  return false;
}

/**
 * Check and enforce task force-block at CLAW_TASK_STALL_FORCE_BLOCK.
 * Returns true if a task was force-blocked (caller should return early).
 */
export async function checkTaskForceBlock(
  clawId: string,
  managed: ManagedClaw,
  cb: CycleOpsCallbacks
): Promise<boolean> {
  const forceBlocked = managed.session.tasks.find(
    (t) => t.status === 'in_progress' && (t.cyclesInProgress ?? 0) >= CLAW_TASK_STALL_FORCE_BLOCK
  );
  if (!forceBlocked) return false;

  const heat = forceBlocked.cyclesInProgress ?? 0;
  log.warn(
    `[${clawId}] task "${forceBlocked.title}" (${forceBlocked.id}) force-blocked at ${heat} cycles ≥ ${CLAW_TASK_STALL_FORCE_BLOCK}; operator escalation fired`
  );
  const priorStatus = forceBlocked.status;
  forceBlocked.status = 'blocked';
  forceBlocked.notes =
    `[AUTO-BLOCKED] Force-blocked by the runtime after ${heat} cycles without status change. ` +
    (forceBlocked.notes ? `Prior notes: ${forceBlocked.notes}` : '');
  forceBlocked.cyclesInProgress = 0;
  delete forceBlocked.autoEscalatedAt;
  forceBlocked.updatedAt = new Date().toISOString();
  cb.recordPlanHistory(managed, {
    at: forceBlocked.updatedAt,
    actor: 'operator',
    kind: 'task_update',
    taskId: forceBlocked.id,
    title: forceBlocked.title,
    prevStatus: priorStatus,
    newStatus: 'blocked',
  });

  // Pull recent failure errors into the agent's inbox for diagnosis context.
  const recentFails = managed.session.recentFailures.slice(-3);
  const failureContext = recentFails.length
    ? `\nRecent failure context (last ${recentFails.length} cycle${recentFails.length === 1 ? '' : 's'}):\n` +
      recentFails
        .map((f, i) => {
          const toolErr = f.toolErrors?.[0];
          const detail = toolErr
            ? `${toolErr.tool}: ${toolErr.error.slice(0, 200)}`
            : (f.error ?? 'no error message').slice(0, 200);
          return `  ${i + 1}. cycle ${f.cycleNumber} — ${detail}`;
        })
        .join('\n')
    : '';

  const nudge =
    `[TASK_FORCE_BLOCKED] The runtime auto-blocked task "${forceBlocked.id}" ("${forceBlocked.title}") after ${heat} cycles without progress.\n\n` +
    `If downstream tasks depend on this one's output, picking a different task will NOT unblock the mission — diagnose first.\n\n` +
    `Required next-cycle action (pick ONE):\n` +
    `  A. ROOT-CAUSE THIS: write your diagnosis (env / perms / wrong tool / wrong args) to .claw/MEMORY.md, then claw_split_task on this one with subtasks that test ONE hypothesis each. Do NOT retry the same approach.\n` +
    `  B. ESCALATE: call claw_request_escalation with a concrete, actionable ask if the failure is outside your control (missing creds, missing tool, external service down).\n` +
    `  C. MARK MISSION BLOCKED: if there is no path forward, claw_complete_report with status="failed" and an explanation — do not silently move to dependent tasks that cannot succeed.${failureContext}`;
  managed.session.inbox.push(nudge);
  const repo = getClawsRepository();
  await repo.appendToInbox(clawId, nudge);
  cb.markDirty(managed);
  cb.emitPlanUpdated(clawId, managed, 'task', forceBlocked.id);

  // Fire operator-facing escalation for load-bearing tasks.
  try {
    await cb.requestEscalation(clawId, {
      id: generateId('esc'),
      type: 'task_force_blocked',
      reason: `Task "${forceBlocked.title}" auto-blocked after ${heat} cycles without progress. Downstream work may depend on this — operator intervention needed.`,
      details: {
        taskId: forceBlocked.id,
        taskTitle: forceBlocked.title,
        cyclesInProgress: heat,
        forceBlockThreshold: CLAW_TASK_STALL_FORCE_BLOCK,
        successCriteria: forceBlocked.successCriteria,
        recentFailures: recentFails.map((f) => ({
          cycleNumber: f.cycleNumber,
          error: f.error,
          toolError: f.toolErrors?.[0],
        })),
        autoTriggered: true,
      },
      requestedAt: new Date(),
    });
  } catch (err) {
    log.warn(
      `[${clawId}] Failed to fire task_force_blocked escalation: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return true;
}

/**
 * Check and enforce task auto-escalation at CLAW_TASK_STALL_AUTO_ESCALATE.
 * Returns true if an escalation was triggered.
 */
export async function checkTaskStallEscalation(
  clawId: string,
  managed: ManagedClaw,
  cb: CycleOpsCallbacks
): Promise<boolean> {
  if (managed.session.state === 'escalation_pending' || managed.session.pendingEscalation) {
    return false;
  }

  const stalled = managed.session.tasks.find(
    (t) =>
      t.status === 'in_progress' &&
      !t.autoEscalatedAt &&
      (t.cyclesInProgress ?? 0) >= CLAW_TASK_STALL_AUTO_ESCALATE
  );
  if (!stalled) return false;

  log.warn(
    `[${clawId}] task "${stalled.title}" (${stalled.id}) stalled at ${stalled.cyclesInProgress} cycles ≥ ${CLAW_TASK_STALL_AUTO_ESCALATE}; requesting task_stalled escalation`
  );
  stalled.autoEscalatedAt = new Date().toISOString();
  cb.markDirty(managed);
  try {
    await cb.requestEscalation(clawId, {
      id: generateId('esc'),
      type: 'task_stalled',
      reason: `Task "${stalled.title}" has been in_progress for ${stalled.cyclesInProgress} cycles without status change. The agent did not split, block, or self-escalate after the stall warning.`,
      details: {
        taskId: stalled.id,
        taskTitle: stalled.title,
        cyclesInProgress: stalled.cyclesInProgress,
        stallAutoEscalateThreshold: CLAW_TASK_STALL_AUTO_ESCALATE,
        successCriteria: stalled.successCriteria,
        autoTriggered: true,
      },
      requestedAt: new Date(),
    });
  } catch (err) {
    log.warn(
      `[${clawId}] Failed to auto-request task_stalled escalation: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return true;
}
