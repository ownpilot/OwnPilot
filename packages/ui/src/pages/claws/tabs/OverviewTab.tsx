import { type Dispatch, type SetStateAction, useState, useCallback } from 'react';
import type { ClawConfig } from '../../../api/endpoints/claws';
import {
  XCircle,
  FolderOpen,
  Send,
  Activity,
  Terminal,
  DollarSign,
  Pause,
  BarChart3,
  FileCode,
  GitBranch,
  Copy,
  CheckCircle2,
  Zap,
  AlertTriangle,
  MessageSquare,
  ExternalLink,
  Layers,
} from '../../../components/icons';
import { formatDuration, formatCost, timeAgo, labelClass as lbl } from '../utils';

const PRIORITY_LABEL: Record<number, string> = {
  1: 'Highest',
  2: 'High',
  3: 'Normal',
  4: 'Low',
  5: 'Lowest',
};

const PRIORITY_COLOR: Record<number, string> = {
  1: 'bg-red-500/10 text-red-600',
  2: 'bg-orange-500/10 text-orange-600',
  3: 'bg-blue-500/10 text-blue-600',
  4: 'bg-amber-500/10 text-amber-600',
  5: 'bg-gray-500/10 text-gray-500',
};

export function OverviewTab({
  claw,
  message,
  setMessage,
  sendMsg,
  onApproveEscalation,
  onDenyEscalation,
  onSwitchToFiles,
  inputClass: ic,
}: {
  claw: ClawConfig;
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  sendMsg: () => void;
  onApproveEscalation: (id: string) => void;
  onDenyEscalation: (id: string) => void;
  onSwitchToFiles: () => void;
  inputClass: string;
}) {
  const session = claw.session;
  const isActive = session && ['running', 'starting', 'waiting'].includes(session.state);
  const cyclesDone = session?.cyclesCompleted ?? 0;
  const totalCost = session?.totalCostUsd ?? 0;
  const totalToolCalls = session?.totalToolCalls ?? 0;
  const avgCostPerCycle = cyclesDone > 0 ? totalCost / cyclesDone : 0;
  const [copiedId, setCopiedId] = useState(false);

  const copyId = useCallback(() => {
    navigator.clipboard.writeText(claw.id).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    });
  }, [claw.id]);

  const sessionAgeMs = session?.startedAt ? Date.now() - new Date(session.startedAt).getTime() : 0;
  const sessionAgeHours = sessionAgeMs / (1000 * 60 * 60);
  const costPerHour = sessionAgeHours > 0 ? totalCost / sessionAgeHours : 0;
  const efficiency = cyclesDone > 0 ? totalToolCalls / cyclesDone : 0;

  return (
    <div className="space-y-4">
      {/* Active status banner */}
      {isActive && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <div className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              {session?.state === 'running'
                ? 'Running'
                : session?.state === 'starting'
                  ? 'Starting'
                  : 'Waiting for event'}
            </p>
            {session?.lastCycleAt && (
              <p className="text-xs text-green-600/70 dark:text-green-500/70">
                Last cycle {timeAgo(session.lastCycleAt)} ·{' '}
                {formatDuration(session.lastCycleDurationMs ?? 0)}
              </p>
            )}
          </div>
          {claw.mode === 'interval' && claw.intervalMs && (
            <span className="text-xs bg-green-500/10 text-green-600 px-2 py-0.5 rounded">
              every {Math.round(claw.intervalMs / 1000)}s
            </span>
          )}
        </div>
      )}

      {/* Paused banner */}
      {session?.state === 'paused' && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <Pause className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">Claw is paused</p>
        </div>
      )}

      {/* Last error */}
      {session?.lastCycleError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-red-600 dark:text-red-400">Last cycle error</p>
            <p className="text-xs text-red-500/80 mt-0.5 font-mono">{session.lastCycleError}</p>
          </div>
        </div>
      )}

      {/* Reflection-loop banner — the agent has crossed the consecutive-failures
          threshold and is being prompted to diagnose root cause. Surfaced on
          the first tab so it's the first thing a user investigating a stuck
          claw sees. */}
      {session && session.consecutiveErrors >= 2 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-red-600 dark:text-red-400">
              Reflection required — {session.consecutiveErrors} consecutive failures
            </p>
            <p className="text-[11px] text-red-500/80 mt-0.5">
              The agent is being prompted to change strategy. See the Plan tab for recent failure
              details.
            </p>
          </div>
        </div>
      )}

      {/* Focus banner — surface the current in-progress task. The plan-tab
          renders the full task list; here we just answer "what is it doing
          right now?" without making the user switch tabs. */}
      {(() => {
        const focus = session?.tasks?.find((t) => t.status === 'in_progress');
        if (!focus) return null;
        const stalled = (focus.cyclesInProgress ?? 0) >= 5;
        return (
          <div
            className={`flex items-start gap-2 p-3 rounded-lg ${
              stalled
                ? 'bg-red-500/10 border border-red-500/20'
                : 'bg-blue-500/10 border border-blue-500/20'
            }`}
          >
            <Activity
              className={`w-4 h-4 shrink-0 mt-0.5 ${stalled ? 'text-red-500' : 'text-blue-500'}`}
            />
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${stalled ? 'text-red-500' : 'text-blue-500'}`}>
                Focus: [{focus.id}] {focus.title}
                {stalled && ` · ⚠ stalled (${focus.cyclesInProgress ?? 0} cycles)`}
              </p>
              {focus.successCriteria && (
                <p className="text-[11px] text-text-muted mt-0.5">{focus.successCriteria}</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Stats grid — 6 key metrics */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {[
          { label: 'Cycles', value: cyclesDone, icon: Activity },
          { label: 'Tool Calls', value: totalToolCalls, icon: Terminal },
          { label: 'Total Cost', value: formatCost(totalCost), icon: DollarSign },
          { label: 'Avg/Cycle', value: formatCost(avgCostPerCycle), icon: BarChart3 },
          { label: 'Artifacts', value: session?.artifacts?.length ?? 0, icon: FileCode },
          { label: 'Depth', value: claw.depth, icon: GitBranch },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-2.5 flex flex-col items-center text-center"
          >
            <s.icon className="w-3.5 h-3.5 text-text-muted mb-1" />
            <p className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
              {s.value}
            </p>
            <p className="text-[10px] text-text-muted dark:text-dark-text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Efficiency + cost/hour row */}
      {session && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 flex flex-col items-center text-center">
            <MessageSquare className="w-3.5 h-3.5 text-text-muted mb-1" />
            <p className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
              {efficiency.toFixed(1)}
            </p>
            <p className="text-[10px] text-text-muted dark:text-dark-text-muted">calls/cycle</p>
          </div>
          <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 flex flex-col items-center text-center">
            <Zap className="w-3.5 h-3.5 text-text-muted mb-1" />
            <p className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
              {formatCost(costPerHour)}/h
            </p>
            <p className="text-[10px] text-text-muted dark:text-dark-text-muted">cost rate</p>
          </div>
        </div>
      )}

      {/* Claw ID + Priority row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <span className="text-[10px] text-text-muted dark:text-dark-text-muted font-medium">
            ID
          </span>
          <code className="text-xs font-mono text-text-secondary dark:text-dark-text-secondary">
            {claw.id.slice(0, 20)}...
          </code>
          <button onClick={copyId} className="p-0.5 hover:bg-bg-tertiary rounded" title="Copy ID">
            {copiedId ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-text-muted" />
            )}
          </button>
        </div>
        <span
          className={`px-2 py-0.5 text-xs rounded-full font-medium ${PRIORITY_COLOR[claw.priority ?? 3]}`}
        >
          P{claw.priority ?? 3} · {PRIORITY_LABEL[claw.priority ?? 3]}
        </span>
        {claw.parentClawId && (
          <a
            href={`/claws?focus=${claw.parentClawId}`}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20"
          >
            <GitBranch className="w-3 h-3" />
            subclaw
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Mission */}
      <div>
        <div className="flex items-center justify-between">
          <p className={lbl}>Mission</p>
          <span className="text-[10px] text-text-muted">{claw.mission.length} chars</span>
        </div>
        <p className="text-sm text-text-secondary dark:text-dark-text-secondary mt-1 whitespace-pre-wrap leading-relaxed bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 border border-border dark:border-dark-border">
          {claw.mission}
        </p>
      </div>

      {/* Config chips */}
      <div className="flex flex-wrap gap-1.5">
        {claw.health && (
          <span
            className={`px-2 py-0.5 text-xs rounded-full font-medium ${
              claw.health.status === 'healthy'
                ? 'bg-emerald-500/10 text-emerald-600'
                : claw.health.status === 'watch'
                  ? 'bg-amber-500/10 text-amber-600'
                  : claw.health.status === 'stuck' || claw.health.status === 'failed'
                    ? 'bg-red-500/10 text-red-600'
                    : 'bg-gray-500/10 text-gray-500'
            }`}
          >
            {claw.health.score} · {claw.health.status}
          </span>
        )}
        <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs rounded-full font-medium">
          {claw.mode}
        </span>
        <span className="px-2 py-0.5 bg-gray-500/10 text-gray-500 text-xs rounded-full">
          sandbox: {claw.sandbox}
        </span>
        {claw.provider ? (
          <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-600 text-xs rounded-full font-medium">
            {claw.provider}
            {claw.model ? ` / ${claw.model}` : ''}
          </span>
        ) : (
          <span className="px-2 py-0.5 bg-gray-500/10 text-gray-500 text-xs rounded-full">
            system model
          </span>
        )}
        {claw.codingAgentProvider && (
          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 text-xs rounded-full font-medium">
            {claw.codingAgentProvider}
          </span>
        )}
        {claw.autoStart && (
          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 text-xs rounded-full font-medium">
            auto-start
          </span>
        )}
        {(claw.skills?.length ?? 0) > 0 && (
          <span className="px-2 py-0.5 bg-pink-500/10 text-pink-600 text-xs rounded-full font-medium">
            {claw.skills!.length} skills
          </span>
        )}
      </div>

      {/* Autonomy policy */}
      {claw.autonomyPolicy && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <p className={`${lbl} mb-2`}>Autonomy Policy</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              {claw.autonomyPolicy.allowSelfModify ? (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              ) : (
                <XCircle className="w-3 h-3 text-red-400" />
              )}
              <span className="text-text-muted">Self-modify</span>
            </div>
            <div className="flex items-center gap-1.5">
              {claw.autonomyPolicy.allowSubclaws ? (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              ) : (
                <XCircle className="w-3 h-3 text-red-400" />
              )}
              <span className="text-text-muted">Subclaws</span>
            </div>
            <div className="flex items-center gap-1.5">
              {claw.autonomyPolicy.requireEvidence ? (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              ) : (
                <XCircle className="w-3 h-3 text-red-400" />
              )}
              <span className="text-text-muted">Evidence</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 text-xs">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            <span className="text-text-muted">Destructive:</span>
            <span className="font-medium text-text-primary dark:text-dark-text-primary capitalize">
              {claw.autonomyPolicy.destructiveActionPolicy}
            </span>
            {claw.autonomyPolicy.maxCostUsdBeforePause && (
              <>
                <span className="text-text-muted mx-1">·</span>
                <span className="text-text-muted">
                  Pause at ${claw.autonomyPolicy.maxCostUsdBeforePause}
                </span>
              </>
            )}
          </div>
          {claw.autonomyPolicy.filesystemScopes.length > 0 && (
            <div className="mt-1.5 text-xs text-text-muted">
              FS scopes: {claw.autonomyPolicy.filesystemScopes.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Mission Contract */}
      {claw.missionContract &&
        (claw.missionContract.successCriteria.length > 0 ||
          claw.missionContract.deliverables.length > 0) && (
          <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
            <div className="flex items-center justify-between mb-2">
              <p className={`${lbl} mb-0`}>Mission Contract</p>
              {claw.missionContract.evidenceRequired && (
                <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">
                  evidence required
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {claw.missionContract.successCriteria.length > 0 && (
                <div>
                  <p className="font-medium text-text-primary dark:text-dark-text-primary mb-1">
                    Success Criteria
                  </p>
                  <ul className="space-y-0.5 text-text-secondary dark:text-dark-text-secondary">
                    {claw.missionContract.successCriteria.map((item) => (
                      <li key={item} className="flex items-start gap-1">
                        <span className="text-green-500 mt-0.5">✓</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {claw.missionContract.deliverables.length > 0 && (
                <div>
                  <p className="font-medium text-text-primary dark:text-dark-text-primary mb-1">
                    Deliverables
                  </p>
                  <ul className="space-y-0.5 text-text-secondary dark:text-dark-text-secondary">
                    {claw.missionContract.deliverables.map((item) => (
                      <li key={item} className="flex items-start gap-1">
                        <span className="text-blue-500 mt-0.5">▸</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {claw.missionContract.escalationRules.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border dark:border-dark-border">
                <p className="font-medium text-text-primary dark:text-dark-text-primary mb-1 text-xs">
                  Escalation Rules
                </p>
                <ul className="space-y-0.5 text-muted dark:text-dark-text-muted text-xs">
                  {claw.missionContract.escalationRules.map((r) => (
                    <li key={r}>↑ {r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

      {/* Workspace */}
      {claw.workspaceId && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <FolderOpen className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">Workspace</p>
            <p className="text-xs font-mono text-text-primary dark:text-dark-text-primary truncate">
              {claw.workspaceId}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onSwitchToFiles} className="text-xs text-primary hover:underline">
              Browse
            </button>
            <a
              href={`/api/v1/file-workspaces/${claw.workspaceId}/download`}
              className="text-xs text-primary hover:underline"
            >
              ZIP
            </a>
            <button
              onClick={() =>
                window.open(
                  `/api/v1/file-workspaces/${claw.workspaceId}/file/.claw/INSTRUCTIONS.md?raw=true`,
                  '_blank'
                )
              }
              className="text-xs text-primary hover:underline"
            >
              Instructions
            </button>
          </div>
        </div>
      )}

      {/* Escalation */}
      {session?.state === 'escalation_pending' && session.pendingEscalation && (
        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
          <p className="text-sm font-medium text-purple-600 dark:text-purple-400">
            Escalation Pending
          </p>
          <p className="text-xs text-purple-500 mt-1">
            [{session.pendingEscalation.type}] {session.pendingEscalation.reason}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => onApproveEscalation(claw.id)}
              className="px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 font-medium"
            >
              Approve
            </button>
            <button
              onClick={() => onDenyEscalation(claw.id)}
              className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 font-medium"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Artifacts */}
      {session?.artifacts && session.artifacts.length > 0 && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <p className={lbl}>Artifacts ({session.artifacts.length})</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {session.artifacts.map((artId) => (
              <a
                key={artId}
                href={`/artifacts?id=${artId}`}
                className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded hover:bg-emerald-500/20 font-mono transition-colors flex items-center gap-1"
              >
                <Layers className="w-3 h-3" />
                {artId.slice(0, 16)}...
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Message input for active claws */}
      {isActive && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span className="text-xs text-text-muted">Send message to claw</span>
            <span className="text-[10px] text-text-muted ml-auto">{message.length}/2000</span>
          </div>
          <div className="flex items-center gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMsg();
                }
              }}
              placeholder="Message to claw... (Enter to send, Shift+Enter for newline)"
              rows={2}
              className={`flex-1 ${ic} placeholder:text-text-muted resize-none`}
            />
            <button
              onClick={sendMsg}
              disabled={!message.trim()}
              className="p-2 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-40 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
