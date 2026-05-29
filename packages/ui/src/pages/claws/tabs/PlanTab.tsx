import { useState } from 'react';
import type {
  ClawConfig,
  ClawTask,
  ClawTaskStatus,
  ClawCycleFailure,
  ClawPlanHistoryEntry,
} from '../../../api/endpoints/claws';
import { clawsApi } from '../../../api/endpoints/claws';
import {
  Target,
  CheckCircle2,
  Ban,
  Clock,
  Activity,
  AlertTriangle,
  Plus,
  Edit,
  X,
} from '../../../components/icons';
import { timeAgo } from '../utils';
import { getStarterPlan, type StarterTask } from '../starter-plans';

const STATUS_META: Record<
  ClawTask['status'],
  { label: string; icon: typeof CheckCircle2; tone: string; bg: string }
> = {
  pending: {
    label: 'Pending',
    icon: Clock,
    tone: 'text-text-muted dark:text-dark-text-muted',
    bg: 'bg-bg-secondary dark:bg-dark-bg-secondary',
  },
  in_progress: {
    label: 'In Progress',
    icon: Activity,
    tone: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    tone: 'text-green-500',
    bg: 'bg-green-500/10',
  },
  blocked: {
    label: 'Blocked',
    icon: Ban,
    tone: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
};

// Mirrors CLAW_TASK_STALL_THRESHOLD on the backend. Hard-coded rather than
// passed through the API to keep the DTO surface small; if the backend
// constant changes, bump it here too.
const STALL_THRESHOLD = 5;

export function PlanTab({ claw, onPlanChanged }: { claw: ClawConfig; onPlanChanged?: () => void }) {
  const session = claw.session;
  const tasks = session?.tasks ?? [];
  const failures = session?.recentFailures ?? [];
  const consecutiveErrors = session?.consecutiveErrors ?? 0;
  const focused = tasks.find((t) => t.status === 'in_progress');

  // Only allow operator edits while the claw is running — the session is
  // in-memory, so edits to a stopped claw would just bounce with a 409.
  const sessionLive =
    session?.state === 'running' ||
    session?.state === 'waiting' ||
    session?.state === 'paused' ||
    session?.state === 'starting' ||
    session?.state === 'escalation_pending';

  const [editError, setEditError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  async function updateTaskStatus(taskId: string, status: ClawTaskStatus) {
    setEditError(null);
    setBusyTaskId(taskId);
    try {
      await clawsApi.updateTask(claw.id, taskId, { status });
      onPlanChanged?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyTaskId(null);
    }
  }

  async function updateTaskEvidence(taskId: string, evidence: string) {
    setEditError(null);
    setBusyTaskId(taskId);
    try {
      await clawsApi.updateTask(claw.id, taskId, { evidence });
      onPlanChanged?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyTaskId(null);
    }
  }

  const [splittingTaskId, setSplittingTaskId] = useState<string | null>(null);

  async function splitTask(
    taskId: string,
    subtasks: Array<{ title: string; successCriteria?: string }>
  ) {
    setEditError(null);
    setBusyTaskId(taskId);
    try {
      await clawsApi.splitTask(claw.id, taskId, subtasks);
      setSplittingTaskId(null);
      onPlanChanged?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyTaskId(null);
    }
  }

  async function applyStarterPlan(starter: StarterTask[]) {
    setEditError(null);
    try {
      await clawsApi.replacePlan(
        claw.id,
        starter.map((t) => ({
          id: t.id,
          title: t.title,
          status: 'pending' as ClawTaskStatus,
          successCriteria: t.successCriteria,
        }))
      );
      onPlanChanged?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addTask(title: string, criteria: string) {
    setEditError(null);
    const existingIds = tasks.map((t) => t.id);
    let n = tasks.length + 1;
    let newId = `t${n}`;
    while (existingIds.includes(newId)) {
      n++;
      newId = `t${n}`;
    }
    try {
      await clawsApi.replacePlan(claw.id, [
        ...tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          notes: t.notes,
          successCriteria: t.successCriteria,
        })),
        {
          id: newId,
          title,
          status: 'pending' as ClawTaskStatus,
          successCriteria: criteria || undefined,
        },
      ]);
      setShowAdd(false);
      onPlanChanged?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    }
  }

  const counts = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    in_progress: tasks.filter((t) => t.status === 'in_progress').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    blocked: tasks.filter((t) => t.status === 'blocked').length,
  };
  const progressPct = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Next-intent handoff — surfaces what's queued for the upcoming cycle.
          Either the agent set it via claw_set_next_intent, or the operator
          queued it via POST /next-intent. Auto-clears once the next cycle
          renders it, so when visible the next cycle has not started yet. */}
      {session?.nextIntent && (
        <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-500/10">
          <p className="text-[11px] uppercase tracking-wide text-purple-500 font-semibold mb-1">
            {session.nextIntent.startsWith('[OPERATOR] ')
              ? '↳ Operator directive (next cycle)'
              : '↻ Next cycle intent'}
          </p>
          <p className="text-xs text-text-primary dark:text-dark-text-primary">
            {session.nextIntent.startsWith('[OPERATOR] ')
              ? session.nextIntent.slice('[OPERATOR] '.length)
              : session.nextIntent}
          </p>
        </div>
      )}

      {/* Operator-side queue: only show when running AND no intent already
          queued, so the operator can either let the agent set its own intent
          or queue a directive themselves. */}
      {sessionLive && !session?.nextIntent && (
        <NextIntentForm
          clawId={claw.id}
          onQueued={onPlanChanged}
          onError={(msg) => setEditError(msg)}
        />
      )}

      {/* Focus banner */}
      {focused ? (
        <FocusBanner task={focused} />
      ) : tasks.some((t) => t.status === 'pending') ? (
        <div className="p-3 rounded-lg border border-dashed border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-xs text-text-muted">
          <span className="font-medium">No active focus.</span> The agent has pending tasks but
          hasn't started one yet.
        </div>
      ) : tasks.length === 0 ? (
        (() => {
          const starter = sessionLive ? getStarterPlan(claw.preset) : null;
          if (starter && starter.length > 0) {
            return (
              <StarterPlanSuggestion
                preset={claw.preset ?? ''}
                starter={starter}
                onApply={() => applyStarterPlan(starter)}
              />
            );
          }
          return (
            <div className="p-3 rounded-lg border border-dashed border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-xs text-text-muted">
              No structured plan yet. The agent can call <code>claw_plan</code> to create one.
            </div>
          );
        })()
      ) : (
        <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/10 text-xs text-green-500">
          All tasks are in terminal states. Plan is complete.
        </div>
      )}

      {/* Reflection / failure banner */}
      {consecutiveErrors >= 2 && (
        <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
            <span className="text-xs font-semibold text-red-500">
              REFLECTION REQUIRED — {consecutiveErrors} consecutive failures
            </span>
          </div>
          <p className="text-[11px] text-text-muted">
            The agent is being prompted to diagnose root cause and try a different strategy.
          </p>
        </div>
      )}

      {/* Progress summary */}
      {counts.total > 0 && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
              Progress
            </p>
            <p className="text-xs text-text-muted">
              {counts.completed} / {counts.total} completed ({progressPct}%)
            </p>
          </div>
          <div className="w-full bg-[#1a1a1a] rounded-full h-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="grid grid-cols-4 gap-1 mt-2 text-[10px]">
            <StatusChip status="pending" count={counts.pending} />
            <StatusChip status="in_progress" count={counts.in_progress} />
            <StatusChip status="completed" count={counts.completed} />
            <StatusChip status="blocked" count={counts.blocked} />
          </div>
        </div>
      )}

      {/* Edit error banner */}
      {editError && (
        <div className="flex items-start gap-2 p-2 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-500">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{editError}</span>
          <button
            onClick={() => setEditError(null)}
            className="text-red-500/70 hover:text-red-500"
            aria-label="dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Add-task control. Only meaningful while the session is live since the
          plan lives on the in-memory session; we'd just bounce with a 409. */}
      {sessionLive &&
        (showAdd ? (
          <AddTaskForm onCancel={() => setShowAdd(false)} onSubmit={addTask} />
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-dashed border-border dark:border-dark-border text-xs text-text-muted hover:text-text-primary hover:border-primary transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add task
          </button>
        ))}

      {/* Task list */}
      {tasks.length > 0 && (
        <div className="space-y-1.5">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              editable={sessionLive}
              busy={busyTaskId === t.id}
              onStatusChange={(status) => updateTaskStatus(t.id, status)}
              onEvidenceChange={(evidence) => updateTaskEvidence(t.id, evidence)}
              splitting={splittingTaskId === t.id}
              onStartSplit={() => setSplittingTaskId(t.id)}
              onCancelSplit={() => setSplittingTaskId(null)}
              onSubmitSplit={(subs) => splitTask(t.id, subs)}
            />
          ))}
        </div>
      )}

      {/* Plan change log — most recent at the top, capped to 20 visible to
          keep the panel scannable. Full ring (50) is still in the data. */}
      {session?.planHistory && session.planHistory.length > 0 && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">
            Plan history ({session.planHistory.length})
          </p>
          <div className="space-y-1">
            {[...session.planHistory]
              .slice(-20)
              .reverse()
              .map((entry, i) => (
                <PlanHistoryRow key={`${entry.at}-${i}`} entry={entry} />
              ))}
          </div>
        </div>
      )}

      {/* Recent failures */}
      {(failures.length > 0 || consecutiveErrors > 0) && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
              Recent Failures ({failures.length})
              {consecutiveErrors > 0 && (
                <span className="ml-2 text-amber-500">· {consecutiveErrors} consecutive</span>
              )}
            </p>
            {sessionLive && (
              <button
                type="button"
                onClick={async () => {
                  setEditError(null);
                  setBusyTaskId('__reset_failures__');
                  try {
                    await clawsApi.resetFailures(claw.id);
                    onPlanChanged?.();
                  } catch (err) {
                    setEditError(err instanceof Error ? err.message : 'Failed to reset failures');
                  } finally {
                    setBusyTaskId(null);
                  }
                }}
                disabled={busyTaskId === '__reset_failures__'}
                className="text-xs px-2 py-1 rounded border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary disabled:opacity-50"
                title="Clear consecutive errors and failure history without restarting"
              >
                Reset
              </button>
            )}
          </div>
          {failures.length > 0 && (
            <div className="space-y-2">
              {failures.map((f, i) => (
                <FailureRow key={i} failure={f} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StarterPlanSuggestion({
  preset,
  starter,
  onApply,
}: {
  preset: string;
  starter: StarterTask[];
  onApply: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-blue-500">Suggested starter plan ({preset})</p>
        <button
          onClick={async () => {
            setBusy(true);
            try {
              await onApply();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          className="px-2.5 py-1 text-[11px] rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {busy ? 'Applying…' : 'Apply plan'}
        </button>
      </div>
      <p className="text-[11px] text-text-muted mb-2">
        Skip the cold start — apply this {starter.length}-task scaffold tailored to the{' '}
        <code>{preset}</code> preset. The agent can edit or extend it on the first cycle.
      </p>
      <ul className="space-y-1">
        {starter.map((t) => (
          <li key={t.id} className="text-[11px] text-text-primary dark:text-dark-text-primary">
            <code className="text-[10px] text-text-muted font-mono mr-1.5">[{t.id}]</code>
            {t.title}
            {t.successCriteria && (
              <span className="block text-[10px] text-text-muted ml-7">↳ {t.successCriteria}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FocusBanner({ task }: { task: ClawTask }) {
  const heat = task.cyclesInProgress ?? 0;
  const stalled = heat >= STALL_THRESHOLD;
  return (
    <div
      className={`p-3 rounded-lg border ${
        stalled ? 'border-red-500/40 bg-red-500/10' : 'border-blue-500/30 bg-blue-500/10'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Target className={`w-3.5 h-3.5 ${stalled ? 'text-red-500' : 'text-blue-500'}`} />
        <span className={`text-xs font-semibold ${stalled ? 'text-red-500' : 'text-blue-500'}`}>
          FOCUS
        </span>
        <span className="text-[10px] text-text-muted ml-auto">
          [{task.id}] · {heat} cycle{heat === 1 ? '' : 's'}
          {stalled && ' · ⚠ STALLED'}
        </span>
      </div>
      <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
        {task.title}
      </p>
      {task.successCriteria && (
        <p className="text-[11px] text-text-muted mt-1.5">
          <span className="text-text-secondary dark:text-dark-text-secondary">
            Success criteria:{' '}
          </span>
          {task.successCriteria}
        </p>
      )}
      {stalled && (
        <p className="text-[11px] text-red-500 mt-1.5 font-medium">
          The agent has been on this task for {heat} cycles without status change. It should split,
          mark blocked, or escalate.
        </p>
      )}
    </div>
  );
}

function StatusChip({ status, count }: { status: ClawTask['status']; count: number }) {
  const meta = STATUS_META[status];
  return (
    <div
      className={`flex items-center justify-center gap-1 px-1.5 py-1 rounded ${meta.bg}`}
      title={meta.label}
    >
      <meta.icon className={`w-3 h-3 ${meta.tone}`} />
      <span className={`font-mono font-semibold ${meta.tone}`}>{count}</span>
    </div>
  );
}

function TaskRow({
  task,
  editable,
  busy,
  onStatusChange,
  onEvidenceChange,
  splitting,
  onStartSplit,
  onCancelSplit,
  onSubmitSplit,
}: {
  task: ClawTask;
  editable: boolean;
  busy: boolean;
  onStatusChange: (status: ClawTaskStatus) => void;
  onEvidenceChange: (evidence: string) => void;
  splitting: boolean;
  onStartSplit: () => void;
  onCancelSplit: () => void;
  onSubmitSplit: (subs: Array<{ title: string; successCriteria?: string }>) => void;
}) {
  const meta = STATUS_META[task.status];
  const Icon = meta.icon;
  const stalled = task.status === 'in_progress' && (task.cyclesInProgress ?? 0) >= STALL_THRESHOLD;
  const [editingEvidence, setEditingEvidence] = useState(false);
  const [evidenceDraft, setEvidenceDraft] = useState(task.evidence ?? '');

  return (
    <div
      className={`p-2.5 rounded-lg border ${
        stalled
          ? 'border-red-500/40 bg-red-500/5'
          : 'border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary'
      } ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.tone}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-[10px] text-text-muted font-mono">[{task.id}]</code>
            <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary truncate">
              {task.title}
            </span>
            {editable ? (
              <select
                value={task.status}
                disabled={busy}
                onChange={(e) => onStatusChange(e.target.value as ClawTaskStatus)}
                className={`ml-auto text-[10px] bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded px-1.5 py-0.5 ${meta.tone}`}
                title="Change status"
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="blocked">Blocked</option>
              </select>
            ) : (
              <span className={`text-[10px] ml-auto ${meta.tone}`}>{meta.label}</span>
            )}
          </div>
          {task.notes && <p className="text-[11px] text-text-muted mt-1 italic">{task.notes}</p>}
          {task.status === 'in_progress' && task.successCriteria && (
            <p className="text-[11px] text-text-muted mt-1">
              <span className="text-text-secondary dark:text-dark-text-secondary">Criteria: </span>
              {task.successCriteria}
            </p>
          )}
          {task.status === 'completed' && (
            <div className="text-[11px] mt-1 flex items-start gap-1">
              <span className="text-text-secondary dark:text-dark-text-secondary shrink-0">
                Evidence:
              </span>
              {editingEvidence ? (
                <div className="flex-1 flex flex-col gap-1">
                  <textarea
                    value={evidenceDraft}
                    onChange={(e) => setEvidenceDraft(e.target.value)}
                    rows={2}
                    className="w-full text-[11px] bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded p-1"
                  />
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => {
                        setEditingEvidence(false);
                        setEvidenceDraft(task.evidence ?? '');
                      }}
                      className="px-2 py-0.5 text-[10px] rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted hover:text-text-primary"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (evidenceDraft.trim().length > 0) {
                          onEvidenceChange(evidenceDraft.trim());
                          setEditingEvidence(false);
                        }
                      }}
                      disabled={busy || evidenceDraft.trim().length === 0}
                      className="px-2 py-0.5 text-[10px] rounded bg-primary text-white hover:bg-primary/80 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {task.evidence ? (
                    <span className="text-text-muted flex-1">{task.evidence}</span>
                  ) : (
                    <span className="text-amber-500 italic flex-1">none recorded</span>
                  )}
                  {editable && (
                    <button
                      onClick={() => {
                        setEvidenceDraft(task.evidence ?? '');
                        setEditingEvidence(true);
                      }}
                      className="text-text-muted hover:text-text-primary shrink-0"
                      title="Edit evidence"
                    >
                      <Edit className="w-3 h-3" />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <p className="text-[10px] text-text-muted mt-1 flex items-center gap-2">
            <span className="flex-1">
              Updated {timeAgo(task.updatedAt)}
              {task.cyclesInProgress != null && task.status === 'in_progress' && (
                <span>
                  {' '}
                  · {task.cyclesInProgress} cycle{task.cyclesInProgress === 1 ? '' : 's'}
                  {stalled && ' ⚠'}
                </span>
              )}
            </span>
            {/* Split only makes sense for tasks that aren't already completed.
                Completed tasks would be confusing to split — the work's done. */}
            {editable && task.status !== 'completed' && !splitting && (
              <button
                onClick={onStartSplit}
                disabled={busy}
                className="text-[10px] text-text-muted hover:text-blue-500 underline disabled:opacity-50"
                title="Atomically split into subtasks"
              >
                split
              </button>
            )}
          </p>
          {splitting && (
            <SplitTaskForm
              parentId={task.id}
              busy={busy}
              onCancel={onCancelSplit}
              onSubmit={onSubmitSplit}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SplitTaskForm({
  parentId,
  busy,
  onCancel,
  onSubmit,
}: {
  parentId: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (subs: Array<{ title: string; successCriteria?: string }>) => void;
}) {
  // Start with 2 empty rows — minimum required by the backend.
  const [rows, setRows] = useState<Array<{ title: string; criteria: string }>>([
    { title: '', criteria: '' },
    { title: '', criteria: '' },
  ]);

  const valid =
    rows.length >= 2 && rows.length <= 10 && rows.every((r) => r.title.trim().length > 0);

  return (
    <div className="mt-2 p-2 rounded border border-blue-500/30 bg-blue-500/5">
      <p className="text-[11px] text-blue-500 mb-1.5">
        Splitting <code>[{parentId}]</code> into subtasks — parent will be marked blocked.
      </p>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-1 items-start">
            <span className="text-[10px] font-mono text-text-muted mt-1.5">
              {parentId}.{i + 1}
            </span>
            <div className="flex-1 flex flex-col gap-0.5">
              <input
                type="text"
                value={r.title}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (i === j ? { ...x, title: e.target.value } : x)))
                }
                placeholder="Subtask title"
                className="text-[11px] bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded p-1"
              />
              <input
                type="text"
                value={r.criteria}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (i === j ? { ...x, criteria: e.target.value } : x)))
                }
                placeholder="Success criteria (optional)"
                className="text-[10px] bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded p-1"
              />
            </div>
            {rows.length > 2 && (
              <button
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="text-text-muted hover:text-red-500 mt-1"
                title="Remove this row"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5 justify-between items-center">
        <button
          onClick={() => rows.length < 10 && setRows([...rows, { title: '', criteria: '' }])}
          disabled={rows.length >= 10}
          className="text-[10px] text-text-muted hover:text-text-primary disabled:opacity-50"
        >
          + add row {rows.length >= 10 ? '(max 10)' : ''}
        </button>
        <div className="flex gap-1">
          <button
            onClick={onCancel}
            className="px-2 py-0.5 text-[10px] rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSubmit(
                rows.map((r) => ({
                  title: r.title.trim(),
                  ...(r.criteria.trim() ? { successCriteria: r.criteria.trim() } : {}),
                }))
              )
            }
            disabled={!valid || busy}
            className="px-2 py-0.5 text-[10px] rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {busy ? 'Splitting…' : `Split into ${rows.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddTaskForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (title: string, criteria: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [criteria, setCriteria] = useState('');
  return (
    <div className="p-2.5 rounded-md border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title (e.g., Add login form validation)"
        className="w-full text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded p-1.5"
        autoFocus
      />
      <input
        type="text"
        value={criteria}
        onChange={(e) => setCriteria(e.target.value)}
        placeholder="Success criteria (optional)"
        className="w-full text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded p-1.5 mt-1.5"
      />
      <div className="flex gap-1.5 justify-end mt-1.5">
        <button
          onClick={onCancel}
          className="px-2.5 py-1 text-[11px] rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit(title.trim(), criteria.trim())}
          disabled={title.trim().length === 0}
          className="px-2.5 py-1 text-[11px] rounded bg-primary text-white hover:bg-primary/80 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// Mirrors CLAW_NEXT_INTENT_MAX on the backend. Hard-coded rather than
// piped through the DTO; if the constant moves, update here too.
const NEXT_INTENT_MAX_LEN = 500;

function NextIntentForm({
  clawId,
  onQueued,
  onError,
}: {
  clawId: string;
  onQueued?: () => void;
  onError?: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left p-2.5 rounded-md border border-dashed border-border dark:border-dark-border text-xs text-text-muted hover:text-text-primary hover:border-purple-500/40"
      >
        + Queue a directive for the next cycle
      </button>
    );
  }

  const trimmed = intent.trim();
  const tooLong = trimmed.length > NEXT_INTENT_MAX_LEN;
  const valid = trimmed.length > 0 && !tooLong;

  return (
    <div className="p-2.5 rounded-md border border-purple-500/30 bg-purple-500/5">
      <p className="text-[11px] uppercase tracking-wide text-purple-500 font-semibold mb-1.5">
        ↳ Queue next-cycle directive
      </p>
      <textarea
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        placeholder="e.g., Switch focus to fixing the failing browser_click selector before continuing the audit"
        className="w-full text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded p-1.5 min-h-[60px]"
        autoFocus
      />
      <div className="flex items-center justify-between mt-1.5">
        <span
          className={`text-[10px] ${tooLong ? 'text-red-500' : 'text-text-muted'}`}
          title={`Max ${NEXT_INTENT_MAX_LEN} chars`}
        >
          {trimmed.length}/{NEXT_INTENT_MAX_LEN}
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setIntent('');
            }}
            disabled={busy}
            className="px-2.5 py-1 text-[11px] rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await clawsApi.setNextIntent(clawId, trimmed);
                setOpen(false);
                setIntent('');
                onQueued?.();
              } catch (err) {
                onError?.(err instanceof Error ? err.message : 'Failed to queue intent');
              } finally {
                setBusy(false);
              }
            }}
            className="px-2.5 py-1 text-[11px] rounded bg-purple-500 text-white hover:bg-purple-500/80 disabled:opacity-50"
          >
            Queue
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanHistoryRow({ entry }: { entry: ClawPlanHistoryEntry }) {
  const actorBadge =
    entry.actor === 'agent' ? 'bg-blue-500/10 text-blue-500' : 'bg-purple-500/10 text-purple-500';
  let label: React.ReactNode;
  if (entry.kind === 'replace') {
    label = (
      <>
        rewrote plan ({entry.newTaskCount ?? 0} task
        {entry.newTaskCount === 1 ? '' : 's'})
      </>
    );
  } else if (entry.kind === 'task_update') {
    label = (
      <>
        <code className="text-[10px]">[{entry.taskId}]</code>{' '}
        {entry.prevStatus && entry.newStatus ? (
          <>
            {entry.prevStatus} → <span className="font-medium">{entry.newStatus}</span>
          </>
        ) : (
          entry.newStatus
        )}
        {entry.title && <span className="text-text-muted"> — {entry.title}</span>}
      </>
    );
  } else if (entry.kind === 'task_added') {
    label = (
      <>
        added <code className="text-[10px]">[{entry.taskId}]</code>
        {entry.title && <span> — {entry.title}</span>}
      </>
    );
  } else {
    label = <>{entry.kind}</>;
  }
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${actorBadge}`}>
        {entry.actor}
      </span>
      <span className="flex-1 truncate text-text-primary dark:text-dark-text-primary">{label}</span>
      <span className="text-[10px] text-text-muted shrink-0">{timeAgo(entry.at)}</span>
    </div>
  );
}

function FailureRow({ failure }: { failure: ClawCycleFailure }) {
  return (
    <div className="p-2 rounded border border-red-500/20 bg-red-500/5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-mono text-red-500">Cycle #{failure.cycleNumber}</span>
        <span className="text-[10px] text-text-muted ml-auto">{timeAgo(failure.at)}</span>
      </div>
      {failure.error && (
        <p className="text-[11px] text-text-primary dark:text-dark-text-primary">{failure.error}</p>
      )}
      {failure.toolErrors && failure.toolErrors.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {failure.toolErrors.map((te, i) => (
            <li key={i} className="text-[10px] text-text-muted">
              <code className="text-red-400">{te.tool}</code>: {te.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
