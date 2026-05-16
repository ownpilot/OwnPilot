/**
 * Claw Context & Reflection Executors
 *
 * Tools that touch the claw's persistent working memory and self-evaluation:
 *  - claw_set_context    — merge updates into persistentContext (null deletes)
 *  - claw_get_context    — read full persistentContext snapshot
 *  - claw_reflect        — read .claw/{TASKS,LOG,MEMORY}.md and summarise progress
 *  - claw_update_config  — mutate this claw's own DB config (self-modification)
 */

import { getErrorMessage } from '@ownpilot/core';
import { getClawContext } from '../../services/claw-context.js';

type ExecResult = { success: boolean; result?: unknown; error?: string };

export async function executeSetContext(args: Record<string, unknown>): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const updates = args.updates as Record<string, unknown> | undefined;
  if (!updates || typeof updates !== 'object') {
    return { success: false, error: 'updates must be an object of key-value pairs' };
  }

  // Working-memory bounds. Without these, a runaway claw can balloon
  // persistentContext into megabytes — every cycle's prompt would then
  // carry the entire blob, and the DB session row would bloat forever.
  const MAX_CONTEXT_KEYS = 100;
  const MAX_KEY_LEN = 64;
  const MAX_VALUE_BYTES = 8 * 1024; // per-value when JSON-encoded
  const MAX_TOTAL_BYTES = 64 * 1024; // overall persistentContext size
  const KEY_RE = /^[a-zA-Z0-9_.\-]+$/;

  try {
    const { getClawManager } = await import('../../services/claw-manager.js');
    const manager = getClawManager();
    const session = manager.getSession(ctx.clawId);
    if (!session) return { success: false, error: 'Claw session not found' };

    // Validate keys + per-value size before mutating, so partial failure
    // can't leave the context in an inconsistent state.
    for (const [key, value] of Object.entries(updates)) {
      if (key.length === 0 || key.length > MAX_KEY_LEN) {
        return {
          success: false,
          error: `Key "${key.slice(0, 32)}..." invalid: length must be 1..${MAX_KEY_LEN}`,
        };
      }
      if (!KEY_RE.test(key)) {
        return {
          success: false,
          error: `Key "${key}" contains invalid characters (allowed: letters, digits, _, -, .)`,
        };
      }
      if (value !== null) {
        const encoded = JSON.stringify(value);
        if (encoded === undefined) {
          return {
            success: false,
            error: `Value for "${key}" is not JSON-serializable`,
          };
        }
        if (Buffer.byteLength(encoded, 'utf-8') > MAX_VALUE_BYTES) {
          return {
            success: false,
            error: `Value for "${key}" exceeds ${MAX_VALUE_BYTES} bytes (use claw_publish_artifact for large payloads)`,
          };
        }
      }
    }

    // Project the post-merge state and check key count + total size before
    // committing.
    const projected: Record<string, unknown> = { ...session.persistentContext };
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) delete projected[key];
      else projected[key] = value;
    }
    if (Object.keys(projected).length > MAX_CONTEXT_KEYS) {
      return {
        success: false,
        error: `Context would exceed ${MAX_CONTEXT_KEYS} keys (currently ${Object.keys(session.persistentContext).length}). Delete unused keys first.`,
      };
    }
    const projectedSize = Buffer.byteLength(JSON.stringify(projected), 'utf-8');
    if (projectedSize > MAX_TOTAL_BYTES) {
      return {
        success: false,
        error: `Context would exceed ${MAX_TOTAL_BYTES} bytes (would be ${projectedSize}). Delete unused keys first or use claw_publish_artifact.`,
      };
    }

    // Commit — merge updates with null-as-delete semantics.
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        delete session.persistentContext[key];
      } else {
        session.persistentContext[key] = value;
      }
    }

    const setKeys = Object.entries(updates)
      .filter(([, v]) => v !== null)
      .map(([k]) => k);
    const deletedKeys = Object.entries(updates)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    // Persist immediately so working-memory mutations survive an unexpected
    // crash before the periodic 30s persist timer fires.
    // flushSession logs its own failures via log.warn — we can swallow here.
    // eslint-disable-next-line no-restricted-syntax
    manager.flushSession(ctx.clawId).catch(() => {});

    return {
      success: true,
      result: {
        set: setKeys,
        deleted: deletedKeys,
        context: session.persistentContext,
        message: `Working Memory updated. ${setKeys.length} key(s) set${deletedKeys.length > 0 ? `, ${deletedKeys.length} key(s) removed` : ''}.`,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to update context: ${getErrorMessage(err)}` };
  }
}

export async function executeGetContext(): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  try {
    const { getClawManager } = await import('../../services/claw-manager.js');
    const session = getClawManager().getSession(ctx.clawId);
    if (!session) return { success: false, error: 'Claw session not found' };

    return {
      success: true,
      result: {
        context: session.persistentContext,
        keys: Object.keys(session.persistentContext),
        size: Object.keys(session.persistentContext).length,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to read context: ${getErrorMessage(err)}` };
  }
}

export async function executeReflect(args: Record<string, unknown>): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const question = args.question as string;
  if (!question?.trim()) {
    return { success: false, error: 'question is required' };
  }

  // Read .claw/ files for self-assessment
  const { readSessionWorkspaceFile } = await import('../../workspace/file-workspace.js');

  const tasks = ctx.workspaceId
    ? (readSessionWorkspaceFile(ctx.workspaceId, '.claw/TASKS.md')?.toString('utf-8') ?? '')
    : '';
  const log = ctx.workspaceId
    ? (readSessionWorkspaceFile(ctx.workspaceId, '.claw/LOG.md')?.toString('utf-8') ?? '')
    : '';
  const memory = ctx.workspaceId
    ? (readSessionWorkspaceFile(ctx.workspaceId, '.claw/MEMORY.md')?.toString('utf-8') ?? '')
    : '';

  // Count task progress
  const todoCount = (tasks.match(/- \[ \]/g) ?? []).length;
  const doneCount = (tasks.match(/- \[x\]/g) ?? []).length;
  const totalTasks = todoCount + doneCount;
  const progressPct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  // Count log entries
  const logLines = log.split('\n').filter((l) => l.trim().length > 0).length;

  // Count memory entries
  const memoryLines = memory
    .split('\n')
    .filter((l) => l.trim().length > 0 && !l.startsWith('#')).length;

  return {
    success: true,
    result: {
      question,
      assessment: {
        tasksTotal: totalTasks,
        tasksDone: doneCount,
        tasksTodo: todoCount,
        progressPercent: progressPct,
        logEntries: logLines,
        memoryEntries: memoryLines,
        recommendation:
          progressPct >= 80
            ? 'Mission is nearly complete. Consider using claw_complete_report to deliver final results.'
            : progressPct >= 50
              ? 'Good progress. Continue working through remaining tasks.'
              : progressPct > 0
                ? 'Some progress made. Review your strategy — are you on the right track?'
                : 'No tasks completed yet. Make sure to update .claw/TASKS.md as you work.',
      },
      hint: 'Update .claw/TASKS.md, .claw/MEMORY.md, and .claw/LOG.md to improve self-assessment accuracy.',
    },
  };
}

export async function executeUpdateConfig(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  // Map snake_case LLM args to camelCase repository fields
  const updates: Record<string, unknown> = {};
  if (args.mission !== undefined) updates.mission = args.mission;
  if (args.mode !== undefined) updates.mode = args.mode;
  if (args.sandbox !== undefined) updates.sandbox = args.sandbox;
  if (args.interval_ms !== undefined) updates.intervalMs = args.interval_ms;
  if (args.stop_condition !== undefined) updates.stopCondition = args.stop_condition;
  if (args.auto_start !== undefined) updates.autoStart = args.auto_start;

  if (Object.keys(updates).length === 0) {
    return { success: false, error: 'No config fields provided to update' };
  }

  try {
    const { getClawsRepository } = await import('../../db/repositories/claws.js');
    const repo = getClawsRepository();
    const current = await repo.getById(ctx.clawId, userId);
    if (current?.autonomyPolicy?.allowSelfModify === false) {
      return {
        success: false,
        error: 'Self-modification is disabled by this claw autonomy policy',
      };
    }

    const updated = await repo.update(ctx.clawId, userId, updates);

    // Hot-reload in-memory config so changes take effect this cycle
    if (updated) {
      try {
        const { getClawManager } = await import('../../services/claw-manager.js');
        getClawManager().updateClawConfig(ctx.clawId, updated);
      } catch {
        // Best-effort — manager may not have this claw loaded
      }
    }

    return {
      success: true,
      result: {
        updated: Object.keys(updates),
        message: `Config updated: ${Object.keys(updates).join(', ')}. Changes are live immediately.`,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to update config: ${getErrorMessage(err)}` };
  }
}
