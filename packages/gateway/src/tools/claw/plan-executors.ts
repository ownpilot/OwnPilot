/**
 * Claw Planning Executors
 *
 * Tools that manage the claw's structured task plan:
 *  - claw_plan          — set/replace the entire plan
 *  - claw_update_task   — change one task's status or notes
 *  - claw_list_tasks    — read the current plan
 *
 * The plan lives on `session.tasks` (typed `ClawTask[]`) and the runner
 * renders it into every cycle prompt. Persistence rides inside
 * persistentContext under `__claw_tasks` so no DB schema change is needed.
 * `manager.flushSession` is called after every mutation so a crash between
 * the 30s persist ticks does not lose plan changes.
 */

import {
  getErrorMessage,
  CLAW_MAX_TASKS,
  CLAW_NEXT_INTENT_MAX,
  type ClawTask,
  type ClawTaskStatus,
} from '@ownpilot/core';
import { getClawContext } from '../../services/claw/context.js';

type ExecResult = { success: boolean; result?: unknown; error?: string };

const VALID_STATUSES: readonly ClawTaskStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'blocked',
] as const;
const MAX_TITLE_LEN = 200;
const MAX_NOTES_LEN = 1000;
const MAX_CRITERIA_LEN = 500;
const MAX_EVIDENCE_LEN = 1000;
const ID_RE = /^[a-zA-Z0-9_.\-]{1,64}$/;

function isValidTaskStatus(s: unknown): s is ClawTaskStatus {
  return typeof s === 'string' && (VALID_STATUSES as readonly string[]).includes(s);
}

// Kept as an alias so existing references inside this file don't churn.
const isValidStatus = isValidTaskStatus;

/**
 * Pure validator that turns a raw `tasks` array into a typed `ClawTask[]`
 * with timestamps and stall counters initialised. Shared by the executor
 * (LLM tool path) and the route handler (operator UI path). Throws on the
 * first violation so callers can surface the message to the user.
 */
export function buildValidatedTasks(raw: unknown): ClawTask[] {
  if (!Array.isArray(raw)) throw new Error('tasks must be an array');
  if (raw.length > CLAW_MAX_TASKS) {
    throw new Error(
      `Plan exceeds maximum of ${CLAW_MAX_TASKS} tasks (got ${raw.length}). Break the mission into sub-claws.`
    );
  }

  const now = new Date().toISOString();
  const seen = new Set<string>();
  const out: ClawTask[] = [];
  let inProgressSeen = 0;

  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`tasks[${i}] must be an object`);
    }
    const t = entry as Record<string, unknown>;
    if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
      throw new Error(`tasks[${i}].id must match ${ID_RE} (e.g. "t1")`);
    }
    if (seen.has(t.id)) {
      throw new Error(`tasks[${i}].id "${t.id}" duplicates an earlier task`);
    }
    seen.add(t.id);

    if (typeof t.title !== 'string' || t.title.trim().length === 0) {
      throw new Error(`tasks[${i}].title is required and must be non-empty`);
    }
    if (t.title.length > MAX_TITLE_LEN) {
      throw new Error(`tasks[${i}].title exceeds ${MAX_TITLE_LEN} chars`);
    }

    const status: ClawTaskStatus = isValidStatus(t.status) ? t.status : 'pending';
    if (status === 'in_progress') {
      inProgressSeen++;
      if (inProgressSeen > 1) {
        throw new Error(
          'At most one task may have status="in_progress" at a time. Mark others "pending" or "blocked"; you can only focus on one thing.'
        );
      }
    }
    if (t.notes !== undefined && typeof t.notes !== 'string') {
      throw new Error(`tasks[${i}].notes must be a string when present`);
    }
    if (typeof t.notes === 'string' && t.notes.length > MAX_NOTES_LEN) {
      throw new Error(`tasks[${i}].notes exceeds ${MAX_NOTES_LEN} chars`);
    }
    if (t.successCriteria !== undefined && typeof t.successCriteria !== 'string') {
      throw new Error(`tasks[${i}].successCriteria must be a string when present`);
    }
    if (typeof t.successCriteria === 'string' && t.successCriteria.length > MAX_CRITERIA_LEN) {
      throw new Error(`tasks[${i}].successCriteria exceeds ${MAX_CRITERIA_LEN} chars`);
    }

    out.push({
      id: t.id,
      title: t.title.trim(),
      status,
      ...(typeof t.notes === 'string' ? { notes: t.notes } : {}),
      ...(typeof t.successCriteria === 'string' && t.successCriteria.trim().length > 0
        ? { successCriteria: t.successCriteria.trim() }
        : {}),
      createdAt: now,
      updatedAt: now,
      cyclesInProgress: 0,
    });
  }
  return out;
}

/** Parsed/validated subtask spec for a split operation. */
interface ValidatedSubtask {
  title: string;
  successCriteria?: string;
}

/** Parsed/validated split operation. */
export interface ValidatedSplit {
  parentId: string;
  subtasks: ValidatedSubtask[];
}

const MIN_SUBTASKS = 2;
const MAX_SUBTASKS = 10;

/**
 * Validate split args without touching state. Shared by tool path + REST.
 * Throws on first violation.
 */
export function validateSplitArgs(args: Record<string, unknown>): ValidatedSplit {
  if (typeof args.task_id !== 'string' || !args.task_id) {
    throw new Error('task_id is required');
  }
  const raw = args.subtasks;
  if (!Array.isArray(raw)) {
    throw new Error('subtasks must be an array');
  }
  if (raw.length < MIN_SUBTASKS) {
    throw new Error(
      `subtasks must have at least ${MIN_SUBTASKS} entries (got ${raw.length}) — splitting into 1 is just a rename, use claw_update_task`
    );
  }
  if (raw.length > MAX_SUBTASKS) {
    throw new Error(
      `subtasks exceeds maximum of ${MAX_SUBTASKS} entries (got ${raw.length}) — break the parent into broader chunks first`
    );
  }
  const subtasks: ValidatedSubtask[] = [];
  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`subtasks[${i}] must be an object`);
    }
    const t = entry as Record<string, unknown>;
    if (typeof t.title !== 'string' || t.title.trim().length === 0) {
      throw new Error(`subtasks[${i}].title is required and must be non-empty`);
    }
    if (t.title.length > MAX_TITLE_LEN) {
      throw new Error(`subtasks[${i}].title exceeds ${MAX_TITLE_LEN} chars`);
    }
    if (t.successCriteria !== undefined && typeof t.successCriteria !== 'string') {
      throw new Error(`subtasks[${i}].successCriteria must be a string when present`);
    }
    if (typeof t.successCriteria === 'string' && t.successCriteria.length > MAX_CRITERIA_LEN) {
      throw new Error(`subtasks[${i}].successCriteria exceeds ${MAX_CRITERIA_LEN} chars`);
    }
    subtasks.push({
      title: t.title.trim(),
      ...(typeof t.successCriteria === 'string' && t.successCriteria.trim().length > 0
        ? { successCriteria: t.successCriteria.trim() }
        : {}),
    });
  }
  return { parentId: args.task_id, subtasks };
}

/**
 * Apply a split in-place: marks parent blocked + inserts subtasks
 * immediately after the parent. Returns the new tasks array (mutated)
 * plus the parent + subtasks for the caller to surface in the result.
 *
 * Subtask ids are derived as `<parentId>.<N>` starting at 1; if a derived
 * id collides with an existing task (rare, but possible if the agent has
 * split before), `<parentId>.<N>r<retry>` is used. The plan stays bounded
 * by CLAW_MAX_TASKS.
 */
export function applySplit(
  tasks: ClawTask[],
  split: ValidatedSplit
): { parent: ClawTask; subtasks: ClawTask[]; tasks: ClawTask[] } {
  const parentIdx = tasks.findIndex((t) => t.id === split.parentId);
  if (parentIdx < 0) {
    throw new Error(
      `Task "${split.parentId}" not found. Use claw_list_tasks to see available ids.`
    );
  }
  const parent = tasks[parentIdx];
  if (!parent) {
    throw new Error(`Task "${split.parentId}" not found.`);
  }
  if (tasks.length + split.subtasks.length > CLAW_MAX_TASKS) {
    throw new Error(
      `Adding ${split.subtasks.length} subtasks would exceed the plan cap of ${CLAW_MAX_TASKS} tasks. Complete or remove tasks first.`
    );
  }

  const now = new Date().toISOString();
  const existingIds = new Set(tasks.map((t) => t.id));
  const childIds: string[] = [];
  const newSubtasks: ClawTask[] = [];

  for (let i = 0; i < split.subtasks.length; i++) {
    const sub = split.subtasks[i]!;
    let candidate = `${parent.id}.${i + 1}`;
    let retry = 0;
    while (existingIds.has(candidate)) {
      retry++;
      candidate = `${parent.id}.${i + 1}r${retry}`;
    }
    existingIds.add(candidate);
    childIds.push(candidate);
    newSubtasks.push({
      id: candidate,
      title: sub.title,
      status: 'pending',
      ...(sub.successCriteria ? { successCriteria: sub.successCriteria } : {}),
      createdAt: now,
      updatedAt: now,
      cyclesInProgress: 0,
    });
  }

  // Mutate parent: blocked + auto-evidence noting the split.
  parent.status = 'blocked';
  parent.cyclesInProgress = 0;
  delete parent.autoEscalatedAt;
  parent.evidence = `Split into: ${childIds.join(', ')}`;
  parent.updatedAt = now;

  // Insert children right after the parent so they read in order.
  tasks.splice(parentIdx + 1, 0, ...newSubtasks);
  return { parent, subtasks: newSubtasks, tasks };
}

/** Parsed/validated single-task update. Pure data — no side effects. */
export interface ValidatedTaskUpdate {
  id: string;
  status?: ClawTaskStatus;
  notes?: string;
  evidence?: string;
}

export function validateTaskUpdateArgs(args: Record<string, unknown>): ValidatedTaskUpdate {
  if (typeof args.id !== 'string' || !args.id) throw new Error('id is required');
  const out: ValidatedTaskUpdate = { id: args.id };
  if (args.status !== undefined) {
    if (!isValidStatus(args.status)) {
      throw new Error(`status must be one of ${VALID_STATUSES.join(', ')}`);
    }
    out.status = args.status;
  }
  if (args.notes !== undefined) {
    if (typeof args.notes !== 'string') throw new Error('notes must be a string when present');
    if (args.notes.length > MAX_NOTES_LEN) throw new Error(`notes exceeds ${MAX_NOTES_LEN} chars`);
    out.notes = args.notes;
  }
  if (args.evidence !== undefined) {
    if (typeof args.evidence !== 'string')
      throw new Error('evidence must be a string when present');
    if (args.evidence.length > MAX_EVIDENCE_LEN)
      throw new Error(`evidence exceeds ${MAX_EVIDENCE_LEN} chars`);
    out.evidence = args.evidence;
  }
  if (out.status === undefined && out.notes === undefined && out.evidence === undefined) {
    throw new Error('At least one of status, notes, or evidence must be provided');
  }
  return out;
}

export async function executePlan(args: Record<string, unknown>): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  let tasks: ClawTask[];
  try {
    tasks = buildValidatedTasks(args.tasks);
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }

  try {
    const { getClawManager } = await import('../../services/claw/manager.js');
    const manager = getClawManager();
    // Use the manager method (actor='agent') so the operation hits the same
    // history-recording + persistence + broadcast path as operator-driven
    // edits. Bypassing it would leave the plan history blind to agent edits.
    const updated = await manager.replacePlan(ctx.clawId, tasks, 'agent');
    if (!updated) return { success: false, error: 'Claw session not found' };
    manager.notifyPlanUpdated(ctx.clawId, 'replace');

    return {
      success: true,
      result: {
        count: updated.length,
        tasks: updated,
        message: `Plan set with ${updated.length} task(s).`,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to set plan: ${getErrorMessage(err)}` };
  }
}

/**
 * In-place mutation of a single task on a live session. Pure function over
 * `tasks` + `update` (the validator output) — caller is responsible for
 * persisting. Throws on focus-discipline violation or missing-id so the
 * tool path and route path produce identical error messages.
 */
export function applyTaskUpdate(
  tasks: ClawTask[],
  update: ValidatedTaskUpdate
): { task: ClawTask; warnings: string[] } {
  const task = tasks.find((t) => t.id === update.id);
  if (!task) {
    throw new Error(`Task "${update.id}" not found. Use claw_list_tasks to see available ids.`);
  }

  // Enforce single-focus invariant: flipping THIS task to in_progress fails
  // if another task is already in_progress. Mirrors Claude Code's TodoWrite.
  if (update.status === 'in_progress' && task.status !== 'in_progress') {
    const otherInProgress = tasks.find((t) => t.id !== task.id && t.status === 'in_progress');
    if (otherInProgress) {
      throw new Error(
        `Cannot start "${task.id}": task "${otherInProgress.id}" is already in_progress. Mark it completed, blocked, or pending first.`
      );
    }
  }

  const statusChanged = update.status !== undefined && update.status !== task.status;
  const completingNow = update.status === 'completed';
  if (update.status !== undefined) task.status = update.status;
  if (update.notes !== undefined) task.notes = update.notes;
  if (typeof update.evidence === 'string' && update.evidence.trim().length > 0) {
    task.evidence = update.evidence.trim();
  }
  task.updatedAt = new Date().toISOString();
  // Reset stall counter on status flip — the task is genuinely moving.
  // Also clear the one-shot auto-escalation marker so the task is eligible
  // for a fresh escalation if it ever stalls again later in its lifecycle.
  if (statusChanged) {
    task.cyclesInProgress = 0;
    delete task.autoEscalatedAt;
  }

  const warnings: string[] = [];
  if (completingNow && !task.evidence) {
    warnings.push(
      `Completed "${task.id}" without recording evidence. ` +
        'Next time, include evidence:"<what changed and how you know it worked>" so the completion is auditable.'
    );
  }
  return { task, warnings };
}

export async function executeUpdateTask(args: Record<string, unknown>): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  let update: ValidatedTaskUpdate;
  try {
    update = validateTaskUpdateArgs(args);
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }

  try {
    const { getClawManager } = await import('../../services/claw/manager.js');
    const manager = getClawManager();
    // Delegate to the manager (actor='agent') so plan-history + persist +
    // broadcast happen uniformly across tool and REST paths.
    let mutation;
    try {
      const result = await manager.updateTaskOnSession(ctx.clawId, update, 'agent');
      if (!result) return { success: false, error: 'Claw session not found' };
      mutation = result;
    } catch (err) {
      return { success: false, error: getErrorMessage(err) };
    }
    manager.notifyPlanUpdated(ctx.clawId, 'task', mutation.task.id);

    return {
      success: true,
      result: {
        task: mutation.task,
        message: `Task "${mutation.task.id}" updated.`,
        ...(mutation.warnings.length > 0 ? { warnings: mutation.warnings } : {}),
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to update task: ${getErrorMessage(err)}` };
  }
}

export async function executeListTasks(): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  try {
    const { getClawManager } = await import('../../services/claw/manager.js');
    const session = getClawManager().getSession(ctx.clawId);
    if (!session) return { success: false, error: 'Claw session not found' };

    const tasks = session.tasks;
    const counts = {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
    };
    return { success: true, result: { tasks, counts } };
  } catch (err) {
    return { success: false, error: `Failed to read tasks: ${getErrorMessage(err)}` };
  }
}

const MAX_THOUGHT_LEN = 4000;

/**
 * Pure-deliberation tool. No side effects beyond appending the thought to
 * .claw/LOG.md so future cycles can audit reasoning. The agent gets back
 * the thought it just recorded — useful for chain-of-thought continuation
 * within a single cycle without polluting the next cycle's prompt.
 */
export async function executeThink(args: Record<string, unknown>): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const thought = args.thought;
  if (typeof thought !== 'string' || thought.trim().length === 0) {
    return { success: false, error: 'thought is required and must be non-empty' };
  }
  if (thought.length > MAX_THOUGHT_LEN) {
    return { success: false, error: `thought exceeds ${MAX_THOUGHT_LEN} chars` };
  }

  try {
    if (ctx.workspaceId) {
      const { readSessionWorkspaceFile, writeSessionWorkspaceFile } =
        await import('../../workspace/file-workspace.js');
      const existing =
        readSessionWorkspaceFile(ctx.workspaceId, '.claw/LOG.md')?.toString('utf-8') ?? '';
      const stamp = new Date().toISOString();
      const entry = `\n### ${stamp} — thought\n${thought.trim()}\n`;
      writeSessionWorkspaceFile(ctx.workspaceId, '.claw/LOG.md', existing + entry);
    }
    return {
      success: true,
      result: {
        thought: thought.trim(),
        recorded: true,
        message:
          'Thought recorded. Now take action — claw_think alone does not move the mission forward.',
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to record thought: ${getErrorMessage(err)}` };
  }
}

/**
 * Atomically split a parent task into subtasks. Marks parent blocked,
 * inserts subtasks immediately after. Delegates state mutation to the
 * manager so persistence + history + broadcast happen uniformly.
 */
export async function executeSplitTask(args: Record<string, unknown>): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  let split: ValidatedSplit;
  try {
    split = validateSplitArgs(args);
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }

  try {
    const { getClawManager } = await import('../../services/claw/manager.js');
    const manager = getClawManager();
    const result = await manager.splitTaskOnSession(ctx.clawId, split, 'agent');
    if (!result) return { success: false, error: 'Claw session not found' };

    return {
      success: true,
      result: {
        parent: result.parent,
        subtasks: result.subtasks,
        message: `Split "${result.parent.id}" into ${result.subtasks.length} subtasks (${result.subtasks.map((s) => s.id).join(', ')}). Parent marked blocked. Mark one subtask in_progress to continue.`,
      },
    };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}

/**
 * Record the agent's intent for the next cycle. The runner renders this
 * prominently in the next cycle prompt and then clears it, so a stale
 * intent can never leak past one cycle. Overwriting is fine — agents that
 * still mean what they said last cycle should re-set the intent.
 */
export async function executeSetNextIntent(args: Record<string, unknown>): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const intent = args.intent;
  if (typeof intent !== 'string' || intent.trim().length === 0) {
    return { success: false, error: 'intent is required and must be non-empty' };
  }
  if (intent.length > CLAW_NEXT_INTENT_MAX) {
    return {
      success: false,
      error: `intent exceeds ${CLAW_NEXT_INTENT_MAX} chars — use .claw/MEMORY.md for longer context`,
    };
  }

  try {
    const { getClawManager } = await import('../../services/claw/manager.js');
    const manager = getClawManager();
    const ok = await manager.setNextIntent(ctx.clawId, intent, 'agent');
    if (!ok) return { success: false, error: 'Claw session not found' };

    return {
      success: true,
      result: {
        intent: intent.trim(),
        message:
          'Next-cycle intent recorded. It will appear at the top of the next cycle prompt and then auto-clear.',
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to set next intent: ${getErrorMessage(err)}` };
  }
}
