import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ClawConfig, ClawDoctorResponse, ClawHistoryEntry } from '../../api/endpoints/claws';
import { clawsApi } from '../../api/endpoints/claws';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/ToastProvider';
import {
  XCircle,
  CheckCircle2,
  FolderOpen,
  Send,
  Save,
  Wrench,
  RefreshCw,
  AlertTriangle,
  Copy,
  DollarSign,
  Activity,
  Settings2,
  FileText,
  Database,
  Terminal,
  GitBranch,
  Edit3,
  Download,
  Pause,
  BarChart3,
  BookOpen,
  Shield,
  FileCode,
  ListChecks,
} from '../../components/icons';
import { formatDuration, formatCost, timeAgo, labelClass as lbl, inputClass as ic } from './utils';
import { authedFetch } from './utils';
import { FileBrowser, FileEditorModal } from './FileBrowser';

// ============================================================================
// Overview
// ============================================================================

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

  return (
    <div className="space-y-4">
      {/* Active status banner */}
      {isActive && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              {session?.state === 'running' ? 'Running' : session?.state === 'starting' ? 'Starting' : 'Waiting for event'}
            </p>
            {session?.lastCycleAt && (
              <p className="text-xs text-green-600/70 dark:text-green-500/70">
                Last cycle {timeAgo(session.lastCycleAt)} · {formatDuration(session.lastCycleDurationMs ?? 0)} duration
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
          <Pause className="w-4 h-4 text-amber-500" />
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

      {/* Stats grid */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {[
          { label: 'Cycles', value: cyclesDone, icon: Activity },
          { label: 'Tool Calls', value: totalToolCalls, icon: Terminal },
          { label: 'Total Cost', value: formatCost(totalCost), icon: DollarSign },
          { label: 'Avg/Cycle', value: formatCost(avgCostPerCycle), icon: BarChart3 },
          { label: 'Artifacts', value: session?.artifacts?.length ?? 0, icon: FileCode },
          { label: 'Depth', value: claw.depth, icon: GitBranch },
        ].map((s) => (
          <div key={s.label} className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-2.5 flex flex-col items-center text-center">
            <s.icon className="w-3.5 h-3.5 text-text-muted mb-1" />
            <p className="text-lg font-bold text-text-primary dark:text-dark-text-primary">{s.value}</p>
            <p className="text-[10px] text-text-muted dark:text-dark-text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Mission */}
      <div>
        <div className="flex items-center justify-between">
          <p className={lbl}>Mission</p>
        </div>
        <p className="text-sm text-text-secondary dark:text-dark-text-secondary mt-1 whitespace-pre-wrap leading-relaxed bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 border border-border dark:border-dark-border">
          {claw.mission}
        </p>
      </div>

      {/* Config chips */}
      <div className="flex flex-wrap gap-1.5">
        {claw.health && (
          <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
            claw.health.status === 'healthy' ? 'bg-emerald-500/10 text-emerald-600' :
            claw.health.status === 'watch' ? 'bg-amber-500/10 text-amber-600' :
            claw.health.status === 'stuck' || claw.health.status === 'failed' ? 'bg-red-500/10 text-red-600' :
            'bg-gray-500/10 text-gray-500'
          }`}>
            {claw.health.score} · {claw.health.status}
          </span>
        )}
        <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs rounded-full font-medium">{claw.mode}</span>
        <span className="px-2 py-0.5 bg-gray-500/10 text-gray-500 text-xs rounded-full">sandbox: {claw.sandbox}</span>
        {claw.provider && (
          <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-600 text-xs rounded-full font-medium">
            {claw.provider}{claw.model ? ` / ${claw.model}` : ''}
          </span>
        )}
        {!claw.provider && (
          <span className="px-2 py-0.5 bg-gray-500/10 text-gray-500 text-xs rounded-full">system model</span>
        )}
        {claw.codingAgentProvider && (
          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 text-xs rounded-full font-medium">
            {claw.codingAgentProvider}
          </span>
        )}
        {claw.autoStart && (
          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 text-xs rounded-full font-medium">auto-start</span>
        )}
        {(claw.skills?.length ?? 0) > 0 && (
          <span className="px-2 py-0.5 bg-pink-500/10 text-pink-600 text-xs rounded-full font-medium">
            {claw.skills!.length} skills
          </span>
        )}
        {claw.parentClawId && (
          <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-600 text-xs rounded-full font-medium">
            subclaw of {claw.parentClawId.slice(0, 16)}...
          </span>
        )}
      </div>

      {/* Mission Contract */}
      {claw.missionContract && (claw.missionContract.successCriteria.length > 0 || claw.missionContract.deliverables.length > 0) && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <div className="flex items-center justify-between mb-2">
            <p className={`${lbl} mb-0`}>Mission Contract</p>
            {claw.missionContract.evidenceRequired && (
              <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">evidence required</span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {claw.missionContract.successCriteria.length > 0 && (
              <div>
                <p className="font-medium text-text-primary dark:text-dark-text-primary mb-1">Success Criteria</p>
                <ul className="space-y-0.5 text-text-secondary dark:text-dark-text-secondary">
                  {claw.missionContract.successCriteria.map((item) => (
                    <li key={item} className="flex items-start gap-1"><span className="text-green-500 mt-0.5">✓</span>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {claw.missionContract.deliverables.length > 0 && (
              <div>
                <p className="font-medium text-text-primary dark:text-dark-text-primary mb-1">Deliverables</p>
                <ul className="space-y-0.5 text-text-secondary dark:text-dark-text-secondary">
                  {claw.missionContract.deliverables.map((item) => (
                    <li key={item} className="flex items-start gap-1"><span className="text-blue-500 mt-0.5">▸</span>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {claw.missionContract.escalationRules.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border dark:border-dark-border">
              <p className="font-medium text-text-primary dark:text-dark-text-primary mb-1 text-xs">Escalation Rules</p>
              <ul className="space-y-0.5 text-text-muted dark:text-dark-text-muted text-xs">
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
            <p className="text-xs font-mono text-text-primary dark:text-dark-text-primary truncate">{claw.workspaceId}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onSwitchToFiles} className="text-xs text-primary hover:underline">Browse</button>
            <a href={`/api/v1/file-workspaces/${claw.workspaceId}/download`} className="text-xs text-primary hover:underline">ZIP</a>
            <button
              onClick={() => window.open(`/api/v1/file-workspaces/${claw.workspaceId}/file/.claw/INSTRUCTIONS.md?raw=true`, '_blank')}
              className="text-xs text-primary hover:underline"
            >Instructions</button>
          </div>
        </div>
      )}

      {/* Escalation */}
      {session?.state === 'escalation_pending' && session.pendingEscalation && (
        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
          <p className="text-sm font-medium text-purple-600 dark:text-purple-400">Escalation Pending</p>
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
                className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded hover:bg-emerald-500/20 font-mono transition-colors"
              >
                {artId.slice(0, 16)}...
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Message input for active claws */}
      {isActive && (
        <div className="flex items-center gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMsg()}
            placeholder="Send a message to this claw..."
            className={`flex-1 ${ic} placeholder:text-text-muted`}
          />
          <button onClick={sendMsg} className="p-2 rounded-lg bg-primary text-white hover:bg-primary/90">
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Stats
// ============================================================================

export function StatsTab({ claw }: { claw: ClawConfig }) {
  const session = claw.session;
  const [stats, setStats] = useState<{ totalCycles: number; totalCost: number; totalToolCalls: number; avgCycleMs: number } | null>(null);

  useEffect(() => {
    clawsApi.getHistory(claw.id, 1, 0).then((r) => {
      const entries = r.entries;
      if (!entries.length) { setStats({ totalCycles: 0, totalCost: 0, totalToolCalls: 0, avgCycleMs: 0 }); return; }
      // Estimate from current session
      setStats({
        totalCycles: session?.cyclesCompleted ?? 0,
        totalCost: session?.totalCostUsd ?? 0,
        totalToolCalls: session?.totalToolCalls ?? 0,
        avgCycleMs: session?.lastCycleDurationMs ?? 0,
      });
    }).catch(() => {});
  }, [claw.id, session]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted dark:text-dark-text-muted">Runtime statistics and cost breakdown.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3">
          <p className="text-xs text-text-muted dark:text-dark-text-muted">Total Cycles</p>
          <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">{session?.cyclesCompleted ?? 0}</p>
        </div>
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3">
          <p className="text-xs text-text-muted dark:text-dark-text-muted">Total Cost</p>
          <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">{formatCost(session?.totalCostUsd ?? 0)}</p>
        </div>
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3">
          <p className="text-xs text-text-muted dark:text-dark-text-muted">Tool Calls</p>
          <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">{session?.totalToolCalls ?? 0}</p>
        </div>
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3">
          <p className="text-xs text-text-muted dark:text-dark-text-muted">Avg Cycle</p>
          <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">{formatDuration(session?.lastCycleDurationMs ?? 0)}</p>
        </div>
      </div>

      {/* Cost breakdown bar */}
      {stats && stats.totalCost > 0 && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">Cost Distribution</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-[#1a1a1a] rounded-full h-3 overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: '60%' }} />
            </div>
            <span className="text-xs font-mono text-green-400">{formatCost(stats.totalCost)}</span>
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-text-muted">
            <span>Budget: {claw.limits.totalBudgetUsd ? `$${claw.limits.totalBudgetUsd}` : 'unlimited'}</span>
            <span>{((stats.totalCost / Math.max(claw.limits.totalBudgetUsd ?? stats.totalCost, 0.01)) * 100).toFixed(1)}% used</span>
          </div>
        </div>
      )}

      {/* Limits config */}
      <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">Limits</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {[
            { label: 'Max Turns/Cycle', value: claw.limits.maxTurnsPerCycle },
            { label: 'Max Tool Calls/Cycle', value: claw.limits.maxToolCallsPerCycle },
            { label: 'Max Cycles/Hour', value: claw.limits.maxCyclesPerHour },
            { label: 'Cycle Timeout', value: formatDuration(claw.limits.cycleTimeoutMs) },
            { label: 'Total Budget', value: claw.limits.totalBudgetUsd ? `$${claw.limits.totalBudgetUsd}` : 'none' },
          ].map((l) => (
            <div key={l.label} className="flex justify-between p-1.5 bg-bg-primary dark:bg-dark-bg-primary rounded">
              <span className="text-text-muted">{l.label}</span>
              <span className="font-mono font-medium text-text-primary dark:text-dark-text-primary">{l.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Session info */}
      <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">Session</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            { label: 'State', value: session?.state ?? 'none' },
            { label: 'Started', value: session?.startedAt ? timeAgo(session.startedAt) : '-' },
            { label: 'Last Cycle', value: session?.lastCycleAt ? timeAgo(session.lastCycleAt) : '-' },
            { label: 'Stopped', value: session?.stoppedAt ? timeAgo(session.stoppedAt) : '-' },
          ].map((l) => (
            <div key={l.label} className="flex justify-between p-1.5 bg-bg-primary dark:bg-dark-bg-primary rounded">
              <span className="text-text-muted">{l.label}</span>
              <span className="font-medium text-text-primary dark:text-dark-text-primary">{l.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stop condition */}
      {claw.stopCondition && (
        <div className="flex items-center gap-2 p-2 rounded bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs text-text-muted">Stop condition:</span>
          <code className="text-xs font-mono text-cyan-400 bg-cyan-500/5 px-1.5 py-0.5 rounded">{claw.stopCondition}</code>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Settings
// ============================================================================

const splitLines = (value: string) =>
  value.split('\n').map((s) => s.trim()).filter(Boolean);

export function SettingsTab({
  claw,
  models,
  configuredProviders,
  onSaved,
}: {
  claw: ClawConfig;
  models: Array<{ id: string; name: string; provider: string; recommended?: boolean }>;
  configuredProviders: string[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [editMission, setEditMission] = useState(claw.mission);
  const [editMode, setEditMode] = useState(claw.mode);
  const [editSandbox, setEditSandbox] = useState(claw.sandbox);
  const [editCodingAgent, setEditCodingAgent] = useState(claw.codingAgentProvider ?? '');
  const [editIntervalMs, setEditIntervalMs] = useState(claw.intervalMs ?? 300_000);
  const [editEventFilters, setEditEventFilters] = useState((claw.eventFilters ?? []).join(', '));
  const [editAutoStart, setEditAutoStart] = useState(claw.autoStart);
  const [editStopCondition, setEditStopCondition] = useState(claw.stopCondition ?? '');
  const [editProvider, setEditProvider] = useState(claw.provider ?? '');
  const [editModel, setEditModel] = useState(claw.model ?? '');
  const [editBudget, setEditBudget] = useState(claw.limits.totalBudgetUsd ?? 0);
  const [editMaxTurns, setEditMaxTurns] = useState(claw.limits.maxTurnsPerCycle);
  const [editMaxToolCalls, setEditMaxToolCalls] = useState(claw.limits.maxToolCallsPerCycle);
  const [editSuccessCriteria, setEditSuccessCriteria] = useState((claw.missionContract?.successCriteria ?? []).join('\n'));
  const [editDeliverables, setEditDeliverables] = useState((claw.missionContract?.deliverables ?? []).join('\n'));
  const [editConstraints, setEditConstraints] = useState((claw.missionContract?.constraints ?? []).join('\n'));
  const [editEscalationRules, setEditEscalationRules] = useState((claw.missionContract?.escalationRules ?? []).join('\n'));
  const [editEvidenceRequired, setEditEvidenceRequired] = useState(claw.missionContract?.evidenceRequired ?? true);
  const [editMinConfidence, setEditMinConfidence] = useState(claw.missionContract?.minConfidence ?? 0.8);
  const [editAllowSelfModify, setEditAllowSelfModify] = useState(claw.autonomyPolicy?.allowSelfModify ?? false);
  const [editAllowSubclaws, setEditAllowSubclaws] = useState(claw.autonomyPolicy?.allowSubclaws ?? true);
  const [editDestructivePolicy, setEditDestructivePolicy] = useState<'ask' | 'block' | 'allow'>(claw.autonomyPolicy?.destructiveActionPolicy ?? 'ask');
  const [editMaxCostBeforePause, setEditMaxCostBeforePause] = useState(claw.autonomyPolicy?.maxCostUsdBeforePause ?? 0);
  const [isSaving, setIsSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<'general' | 'ai' | 'autonomy' | 'contract'>('general');

  useEffect(() => {
    setEditMission(claw.mission);
    setEditMode(claw.mode);
    setEditSandbox(claw.sandbox);
    setEditCodingAgent(claw.codingAgentProvider ?? '');
    setEditIntervalMs(claw.intervalMs ?? 300_000);
    setEditEventFilters((claw.eventFilters ?? []).join(', '));
    setEditAutoStart(claw.autoStart);
    setEditStopCondition(claw.stopCondition ?? '');
    setEditProvider(claw.provider ?? '');
    setEditModel(claw.model ?? '');
    setEditBudget(claw.limits.totalBudgetUsd ?? 0);
    setEditMaxTurns(claw.limits.maxTurnsPerCycle);
    setEditMaxToolCalls(claw.limits.maxToolCallsPerCycle);
    setEditSuccessCriteria((claw.missionContract?.successCriteria ?? []).join('\n'));
    setEditDeliverables((claw.missionContract?.deliverables ?? []).join('\n'));
    setEditConstraints((claw.missionContract?.constraints ?? []).join('\n'));
    setEditEscalationRules((claw.missionContract?.escalationRules ?? []).join('\n'));
    setEditEvidenceRequired(claw.missionContract?.evidenceRequired ?? true);
    setEditMinConfidence(claw.missionContract?.minConfidence ?? 0.8);
    setEditAllowSelfModify(claw.autonomyPolicy?.allowSelfModify ?? false);
    setEditAllowSubclaws(claw.autonomyPolicy?.allowSubclaws ?? true);
    setEditDestructivePolicy(claw.autonomyPolicy?.destructiveActionPolicy ?? 'ask');
    setEditMaxCostBeforePause(claw.autonomyPolicy?.maxCostUsdBeforePause ?? 0);
  }, [claw.id]);

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      await clawsApi.update(claw.id, {
        mission: editMission,
        mode: editMode,
        sandbox: editSandbox,
        coding_agent_provider: editCodingAgent || null,
        provider: editProvider || null,
        model: editModel || null,
        interval_ms: editMode === 'interval' ? editIntervalMs : undefined,
        event_filters: editMode === 'event' && editEventFilters.trim()
          ? editEventFilters.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        auto_start: editAutoStart,
        stop_condition: editStopCondition.trim() || null,
        mission_contract: {
          successCriteria: splitLines(editSuccessCriteria),
          deliverables: splitLines(editDeliverables),
          constraints: splitLines(editConstraints),
          escalationRules: splitLines(editEscalationRules),
          evidenceRequired: editEvidenceRequired,
          minConfidence: editMinConfidence,
        },
        autonomy_policy: {
          allowSelfModify: editAllowSelfModify,
          allowSubclaws: editAllowSubclaws,
          requireEvidence: editEvidenceRequired,
          destructiveActionPolicy: editDestructivePolicy,
          filesystemScopes: claw.autonomyPolicy?.filesystemScopes ?? [],
          maxCostUsdBeforePause: editMaxCostBeforePause > 0 ? editMaxCostBeforePause : undefined,
        },
        limits: {
          ...claw.limits,
          totalBudgetUsd: editBudget > 0 ? editBudget : undefined,
          maxTurnsPerCycle: editMaxTurns,
          maxToolCallsPerCycle: editMaxToolCalls,
        },
      });
      toast.success('Settings saved');
      onSaved();
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const sectionTab = (id: 'general' | 'ai' | 'autonomy' | 'contract', label: string, icon: React.ReactNode) => (
    <button
      key={id}
      onClick={() => setActiveSection(id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        activeSection === id
          ? 'bg-primary/10 text-primary border border-primary/20'
          : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Section tabs */}
      <div className="flex items-center gap-2 border-b border-border dark:border-dark-border pb-2">
        {sectionTab('general', 'General', <Settings2 className="w-3.5 h-3.5" />)}
        {sectionTab('ai', 'AI Model', <Activity className="w-3.5 h-3.5" />)}
        {sectionTab('autonomy', 'Autonomy', <Shield className="w-3.5 h-3.5" />)}
        {sectionTab('contract', 'Contract', <BookOpen className="w-3.5 h-3.5" />)}
      </div>

      {/* === GENERAL === */}
      {activeSection === 'general' && (
        <div className="space-y-4">
          <div>
            <label className={lbl}>Mission</label>
            <textarea
              value={editMission}
              onChange={(e) => setEditMission(e.target.value)}
              rows={5}
              className={`${ic} resize-none`}
              placeholder="What should this claw do?"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={lbl}>Mode</label>
              <select value={editMode} onChange={(e) => setEditMode(e.target.value as typeof editMode)} className={ic}>
                <option value="single-shot">Single-shot</option>
                <option value="continuous">Continuous</option>
                <option value="interval">Interval</option>
                <option value="event">Event-driven</option>
              </select>
            </div>
            <div>
              <label className={lbl}>Sandbox</label>
              <select value={editSandbox} onChange={(e) => setEditSandbox(e.target.value as typeof editSandbox)} className={ic}>
                <option value="auto">Auto</option>
                <option value="docker">Docker</option>
                <option value="local">Local</option>
              </select>
            </div>
            <div>
              <label className={lbl}>Coding Agent</label>
              <select value={editCodingAgent} onChange={(e) => setEditCodingAgent(e.target.value)} className={ic}>
                <option value="">None</option>
                <option value="claude-code">Claude Code</option>
                <option value="codex">Codex CLI</option>
                <option value="gemini-cli">Gemini CLI</option>
              </select>
            </div>
            <div>
              <label className={lbl}>Auto-start</label>
              <label className="flex items-center gap-2 h-full px-3">
                <input
                  type="checkbox"
                  checked={editAutoStart}
                  onChange={(e) => setEditAutoStart(e.target.checked)}
                  className="w-4 h-4 rounded accent-primary"
                />
                <span className="text-sm">Start on boot</span>
              </label>
            </div>
          </div>

          {editMode === 'interval' && (
            <div>
              <label className={lbl}>Interval (seconds)</label>
              <input
                type="number"
                value={Math.round(editIntervalMs / 1000)}
                onChange={(e) => setEditIntervalMs(Number(e.target.value) * 1000)}
                min={10}
                className={ic}
              />
            </div>
          )}

          {editMode === 'event' && (
            <div>
              <label className={lbl}>Event Filters (comma-separated)</label>
              <input
                value={editEventFilters}
                onChange={(e) => setEditEventFilters(e.target.value)}
                placeholder="user.message, webhook.received"
                className={ic}
              />
            </div>
          )}

          <div>
            <label className={lbl}>Stop Condition</label>
            <input
              value={editStopCondition}
              onChange={(e) => setEditStopCondition(e.target.value)}
              placeholder="e.g. max_cycles:100, on_report, idle:3"
              className={ic}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Max Turns/Cycle</label>
              <input type="number" value={editMaxTurns} onChange={(e) => setEditMaxTurns(Number(e.target.value))} min={1} max={500} className={ic} />
            </div>
            <div>
              <label className={lbl}>Max Tool Calls/Cycle</label>
              <input type="number" value={editMaxToolCalls} onChange={(e) => setEditMaxToolCalls(Number(e.target.value))} min={1} max={2000} className={ic} />
            </div>
          </div>

          <div>
            <label className={lbl}>Total Budget (USD)</label>
            <input type="number" value={editBudget} onChange={(e) => setEditBudget(Number(e.target.value))} min={0} step={0.1} className={ic} placeholder="0 = no limit" />
          </div>
        </div>
      )}

      {/* === AI MODEL === */}
      {activeSection === 'ai' && (
        <div className="space-y-4">
          <div>
            <label className={lbl}>AI Provider</label>
            <select
              value={editProvider}
              onChange={(e) => { setEditProvider(e.target.value); setEditModel(''); }}
              className={ic}
            >
              <option value="">System Default (pulse)</option>
              {configuredProviders.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {!editProvider && (
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">Uses system model routing. Set a provider to override.</p>
            )}
          </div>

          <div>
            <label className={lbl}>AI Model</label>
            <select
              value={editModel}
              onChange={(e) => setEditModel(e.target.value)}
              disabled={!editProvider}
              className={ic}
            >
              <option value="">System Default</option>
              {editProvider && models
                .filter((m) => !editProvider || m.provider === editProvider)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.recommended ? ' ★' : ''}{!editProvider ? ` (${m.provider})` : ''}
                  </option>
                ))}
            </select>
          </div>

          <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Model selection requires a provider. The claw will use system defaults when no provider/model is selected.
              Set both to lock the model for this claw.
            </p>
          </div>
        </div>
      )}

      {/* === AUTONOMY === */}
      {activeSection === 'autonomy' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border cursor-pointer">
              <input type="checkbox" checked={editAllowSubclaws} onChange={(e) => setEditAllowSubclaws(e.target.checked)} className="w-4 h-4 rounded accent-primary" />
              <div>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">Sub-claws</span>
                <p className="text-xs text-text-muted">Allow spawning child claws</p>
              </div>
            </label>
            <label className="flex items-center gap-2 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border cursor-pointer">
              <input type="checkbox" checked={editAllowSelfModify} onChange={(e) => setEditAllowSelfModify(e.target.checked)} className="w-4 h-4 rounded accent-primary" />
              <div>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">Self-modify</span>
                <p className="text-xs text-text-muted">Allow modifying own config</p>
              </div>
            </label>
          </div>

          <div>
            <label className={lbl}>Destructive Action Policy</label>
            <select value={editDestructivePolicy} onChange={(e) => setEditDestructivePolicy(e.target.value as 'ask' | 'block' | 'allow')} className={ic}>
              <option value="ask">Ask before destructive actions</option>
              <option value="block">Block all destructive actions</option>
              <option value="allow">Allow destructive actions</option>
            </select>
          </div>

          <div>
            <label className={lbl}>Max Cost Before Escalation ($)</label>
            <input
              type="number"
              value={editMaxCostBeforePause}
              onChange={(e) => setEditMaxCostBeforePause(Number(e.target.value))}
              min={0}
              step={0.1}
              className={ic}
              placeholder="0 = no limit"
            />
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">Escalate when cost exceeds this threshold. 0 = disabled.</p>
          </div>

          {claw.autonomyPolicy?.filesystemScopes && claw.autonomyPolicy.filesystemScopes.length > 0 && (
            <div>
              <label className={lbl}>Filesystem Scopes</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {claw.autonomyPolicy.filesystemScopes.map((scope) => (
                  <span key={scope} className="px-2 py-0.5 text-xs bg-gray-500/10 text-gray-600 rounded font-mono">{scope}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* === CONTRACT === */}
      {activeSection === 'contract' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Success Criteria</label>
              <textarea
                value={editSuccessCriteria}
                onChange={(e) => setEditSuccessCriteria(e.target.value)}
                rows={4}
                placeholder="One criterion per line"
                className={`${ic} resize-none`}
              />
            </div>
            <div>
              <label className={lbl}>Deliverables</label>
              <textarea
                value={editDeliverables}
                onChange={(e) => setEditDeliverables(e.target.value)}
                rows={4}
                placeholder="One deliverable per line"
                className={`${ic} resize-none`}
              />
            </div>
          </div>

          <div>
            <label className={lbl}>Constraints</label>
            <textarea
              value={editConstraints}
              onChange={(e) => setEditConstraints(e.target.value)}
              rows={3}
              placeholder="One constraint per line"
              className={`${ic} resize-none`}
            />
          </div>

          <div>
            <label className={lbl}>Escalation Rules</label>
            <textarea
              value={editEscalationRules}
              onChange={(e) => setEditEscalationRules(e.target.value)}
              rows={3}
              placeholder="When to escalate (one rule per line)"
              className={`${ic} resize-none`}
            />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editEvidenceRequired} onChange={(e) => setEditEvidenceRequired(e.target.checked)} className="w-4 h-4 rounded accent-primary" />
              <span className="text-sm">Evidence required</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm">Min confidence:</span>
              <input
                type="number"
                value={editMinConfidence}
                onChange={(e) => setEditMinConfidence(Number(e.target.value))}
                min={0.1}
                max={1}
                step={0.05}
                className="w-16 px-2 py-1 text-sm rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
              />
            </div>
          </div>
        </div>
      )}

      <button
        onClick={saveSettings}
        disabled={isSaving}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {isSaving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}

// ============================================================================
// Memory / .claw/ Files
// ============================================================================

export function MemoryTab({ claw }: { claw: ClawConfig }) {
  const toast = useToast();
  const [memoryFiles, setMemoryFiles] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState<string[]>([]);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const clawFiles = ['INSTRUCTIONS.md', 'TASKS.md', 'MEMORY.md', 'LOG.md'];

  useEffect(() => {
    if (!claw.workspaceId) return;
    setLoadingFiles(clawFiles);
    Promise.all(
      clawFiles.map(async (f) => {
        try {
          const res = await authedFetch(`/api/v1/file-workspaces/${claw.workspaceId}/file/.claw/${f}?raw=true`);
          const text = res.ok ? await res.text() : '';
          const status = res.status;
          if (!res.ok) {
            console.warn(`[MemoryTab] Failed to load .claw/${f}: ${res.status} ${res.statusText}`);
          }
          return { name: f, content: text, status };
        } catch (err) {
          console.warn(`[MemoryTab] Exception loading .claw/${f}:`, err);
          return { name: f, content: '', status: 0 };
        }
      })
    ).then((results) => {
      const map: Record<string, string> = {};
      for (const r of results) map[r.name] = r.content;
      setMemoryFiles(map);
      setLoadingFiles([]);
    });
  }, [claw.workspaceId]);

  const startEdit = (name: string) => {
    setEditingFile(name);
    setEditContent(memoryFiles[name] ?? '');
  };

  const saveFile = async () => {
    if (!editingFile || !claw.workspaceId) return;
    setIsSaving(true);
    try {
      const res = await authedFetch(`/api/v1/file-workspaces/${claw.workspaceId}/file/.claw/${editingFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Save failed: ${res.status} ${errText}`);
      }
      setMemoryFiles((prev) => ({ ...prev, [editingFile]: editContent }));
      setEditingFile(null);
      toast.success(`${editingFile} saved`);
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = (content: string) => {
    navigator.clipboard.writeText(content).then(() => toast.success('Copied')).catch(() => toast.error('Copy failed'));
  };

  if (!claw.workspaceId) {
    return <p className="text-sm text-text-muted py-8 text-center">No workspace assigned.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          .claw/ directive files — the claw's persistent working memory.
        </p>
        <div className="flex items-center gap-2">
          {editingFile && (
            <>
              <button onClick={saveFile} disabled={isSaving} className="px-2 py-1 text-xs rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditingFile(null)} className="px-2 py-1 text-xs rounded text-text-muted hover:text-text-primary">
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {loadingFiles.length > 0 ? (
        <LoadingSpinner message="Loading .claw/ files..." />
      ) : (
        <div className="space-y-4">
          {clawFiles.map((name) => {
            const content = memoryFiles[name] ?? '';
            const isEditing = editingFile === name;
            const isEmpty = !content.trim();
            const FileIcon = name === 'INSTRUCTIONS.md' ? BookOpen : name === 'TASKS.md' ? ListChecks : name === 'MEMORY.md' ? Database : FileText;

            return (
              <div key={name} className="rounded-lg border border-border dark:border-dark-border overflow-hidden">
                {/* File header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border">
                  <FileIcon className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-mono font-medium text-text-primary dark:text-dark-text-primary">.claw/{name}</span>
                  <span className="text-xs text-text-muted">({content.length} chars)</span>
                  {!content && (
                    <span className="text-xs text-red-400 ml-1" title="File empty or load failed — check browser console for status">⚠ empty</span>
                  )}
                  <div className="flex-1" />
                  {!isEditing && (
                    <>
                      <button onClick={() => copyToClipboard(content)} className="text-xs text-text-muted hover:text-text-primary" title="Copy">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {name !== 'LOG.md' && (
                        <button onClick={() => startEdit(name)} className="text-xs text-primary hover:underline" title="Edit">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <a
                        href={`/api/v1/file-workspaces/${claw.workspaceId}/file/.claw/${name}?download=true`}
                        className="text-xs text-text-muted hover:text-text-primary"
                        title="Download"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </>
                  )}
                </div>

                {/* File content */}
                {isEditing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full p-4 text-sm font-mono bg-[#1e1e2e] text-[#cdd6f4] border-none resize-none focus:outline-none leading-relaxed"
                    style={{ minHeight: '200px' }}
                    autoFocus
                  />
                ) : isEmpty ? (
                  <div className="p-4 text-sm text-text-muted italic">No content yet. The claw will write here during execution.</div>
                ) : (
                  <pre className="p-4 text-sm font-mono text-text-secondary dark:text-dark-text-secondary whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto bg-[#0d0d0d]">
                    {content}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Config (raw JSON)
// ============================================================================

export function ConfigTab({ claw }: { claw: ClawConfig }) {
  const [copied, setCopied] = useState(false);
  const config = JSON.stringify(claw, null, 2);
  const copy = () => {
    navigator.clipboard.writeText(config).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">Full claw configuration as JSON.</p>
        <button onClick={copy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border dark:border-dark-border hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary">
          <Copy className="w-3.5 h-3.5" />
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono bg-[#0d0d0d] text-gray-300 rounded-lg overflow-auto max-h-[500px] whitespace-pre-wrap leading-relaxed border border-border dark:border-dark-border">
        {config}
      </pre>
    </div>
  );
}

// ============================================================================
// Doctor
// ============================================================================

const patchLabel: Record<string, string> = {
  mission_contract: 'Mission contract',
  stop_condition: 'Stop condition',
  autonomy_policy: 'Autonomy policy',
};

function formatPatchValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  if (value === null) return 'clear';
  if (value === undefined) return '-';
  return String(value);
}

export function DoctorTab({
  claw,
  doctor,
  isLoadingDoctor,
  isApplyingDoctorFixes,
  loadDoctor,
  applyDoctorFixes,
}: {
  claw: ClawConfig;
  doctor: ClawDoctorResponse | null;
  isLoadingDoctor: boolean;
  isApplyingDoctorFixes: boolean;
  loadDoctor: () => void;
  applyDoctorFixes: () => void;
}) {
  const patchEntries = Object.entries(doctor?.patch ?? {});
  const health = doctor?.health ?? claw.health;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">Health Report</p>
          <p className="text-xs text-text-muted dark:text-dark-text-muted">Configuration diagnostics and safe fixes.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadDoctor} disabled={isLoadingDoctor} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border dark:border-dark-border hover:bg-bg-secondary disabled:opacity-50">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button
            onClick={applyDoctorFixes}
            disabled={isLoadingDoctor || isApplyingDoctorFixes || patchEntries.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            <Wrench className="w-3.5 h-3.5" />
            {isApplyingDoctorFixes ? 'Applying...' : 'Apply Fixes'}
          </button>
        </div>
      </div>

      {isLoadingDoctor ? (
        <LoadingSpinner message="Running diagnostics..." />
      ) : (
        <>
          {health && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Health', value: health.score, color: health.score >= 80 ? 'text-green-400' : health.score >= 50 ? 'text-amber-400' : 'text-red-400' },
                { label: 'Status', value: health.status, color: 'text-text-primary' },
                { label: 'Contract', value: health.contractScore, color: health.contractScore >= 80 ? 'text-green-400' : 'text-amber-400' },
                { label: 'Warnings', value: health.policyWarnings.length, color: health.policyWarnings.length > 0 ? 'text-amber-400' : 'text-green-400' },
              ].map((s) => (
                <div key={s.label} className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 text-center">
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">{s.label}</p>
                  <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {(health?.signals.length ?? 0) > 0 && (
            <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
              <p className={lbl}>Signals</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {health!.signals.map((signal) => (
                  <span key={signal} className="px-2 py-0.5 text-xs rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    {signal}
                  </span>
                ))}
              </div>
            </div>
          )}

          {patchEntries.length > 0 ? (
            <div className="space-y-2">
              <p className={lbl}>Recommended Fixes ({patchEntries.length})</p>
              {patchEntries.map(([field, value]) => (
                <div key={field} className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary">{patchLabel[field] ?? field}</p>
                    <span className="text-[10px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded shrink-0">auto-fix</span>
                  </div>
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-text-secondary dark:text-dark-text-secondary font-mono">
                    {formatPatchValue(value)}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-sm text-emerald-700 dark:text-emerald-300">All checks passed. No fixes needed.</p>
            </div>
          )}

          {(doctor?.skipped.length ?? 0) > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Manual decisions needed</p>
                <ul className="mt-1 list-disc list-inside text-xs text-amber-700/80 dark:text-amber-300/80 space-y-0.5">
                  {doctor!.skipped.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </div>
          )}

          {(health?.recommendations.length ?? 0) > 0 && (
            <div className="p-3 rounded-lg border border-border dark:border-dark-border">
              <p className={lbl}>Recommendations</p>
              <ul className="mt-2 list-disc list-inside text-xs text-text-secondary dark:text-dark-text-secondary space-y-1">
                {health!.recommendations.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Skills
// ============================================================================

export function SkillsTab({
  availableSkills,
  selectedSkills,
  setSelectedSkills,
  saveSkills,
  isSavingSkills,
}: {
  availableSkills: Array<{ id: string; name: string; toolCount: number }>;
  selectedSkills: string[];
  setSelectedSkills: Dispatch<SetStateAction<string[]>>;
  saveSkills: () => void;
  isSavingSkills: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        Select which skills (extensions) this claw can use. Each skill provides specialized toolsets.
      </p>
      {availableSkills.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-text-muted dark:text-dark-text-muted">No skills installed.</p>
          <p className="text-xs text-text-muted mt-1">Install skills from the Skills Hub.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {availableSkills.map((sk) => (
            <label
              key={sk.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                selectedSkills.includes(sk.id)
                  ? 'bg-primary/10 border border-primary/20'
                  : 'hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary border border-transparent'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedSkills.includes(sk.id)}
                onChange={() =>
                  setSelectedSkills((p) =>
                    p.includes(sk.id) ? p.filter((s) => s !== sk.id) : [...p, sk.id]
                  )
                }
                className="w-4 h-4 rounded accent-primary"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">{sk.name}</span>
                <span className="text-xs text-text-muted dark:text-dark-text-muted ml-2">{sk.toolCount} tools</span>
              </div>
            </label>
          ))}
        </div>
      )}
      <button
        onClick={saveSkills}
        disabled={isSavingSkills}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {isSavingSkills ? 'Saving...' : `Save Skills (${selectedSkills.length} selected)`}
      </button>
    </div>
  );
}

// ============================================================================
// History
// ============================================================================

export function HistoryTab({
  history,
  historyTotal,
  isLoadingHistory,
  loadHistory,
}: {
  history: ClawHistoryEntry[];
  historyTotal: number;
  isLoadingHistory: boolean;
  loadHistory: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all');

  const filtered = filter === 'all' ? history : history.filter((e) => filter === 'success' ? e.success : !e.success);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">{historyTotal} total cycles</p>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
          >
            <option value="all">All</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
          <button onClick={loadHistory} className="text-xs text-primary hover:underline">Refresh</button>
        </div>
      </div>

      {isLoadingHistory ? (
        <LoadingSpinner message="Loading..." />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">No cycles yet.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <div key={entry.id} className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
              <div className="flex items-center gap-2 mb-1">
                {entry.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                )}
                <span className="text-xs font-mono font-medium text-text-primary">Cycle {entry.cycleNumber}</span>
                <span className="text-xs text-text-muted">{formatDuration(entry.durationMs)}</span>
                {entry.costUsd !== undefined && <span className="text-xs text-green-500">{formatCost(entry.costUsd)}</span>}
                <span className="text-xs text-text-muted">{entry.toolCalls.length} tools</span>
                {entry.entryType === 'escalation' && (
                  <span className="text-[10px] bg-purple-500/10 text-purple-600 px-1.5 py-0.5 rounded">escalation</span>
                )}
                <div className="flex-1" />
                <span className="text-xs text-text-muted">{timeAgo(entry.executedAt)}</span>
              </div>
              <p className="text-xs text-text-secondary dark:text-dark-text-secondary line-clamp-2 font-mono mt-1">
                {entry.error ?? entry.outputMessage.slice(0, 200)}
              </p>
              {entry.toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {entry.toolCalls.slice(0, 8).map((tc, i) => (
                    <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${tc.success ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                      {tc.tool}
                    </span>
                  ))}
                  {entry.toolCalls.length > 8 && (
                    <span className="text-[10px] text-text-muted">+{entry.toolCalls.length - 8} more</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Timeline
// ============================================================================

const CYCLE_BAR_COLOR: Record<string, string> = {
  success: 'bg-green-500',
  failed: 'bg-red-500',
  error: 'bg-amber-500',
  escalation: 'bg-purple-500',
  default: 'bg-blue-500',
};

export function TimelineTab({
  history,
  historyTotal,
  isLoadingHistory,
  loadHistory,
}: {
  history: ClawHistoryEntry[];
  historyTotal: number;
  isLoadingHistory: boolean;
  loadHistory: () => void;
}) {
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);
  const maxDuration = Math.max(...history.map((e) => e.durationMs), 1);
  const now = Date.now();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">{historyTotal} cycles — width = relative duration</p>
        <button onClick={loadHistory} className="text-xs text-primary hover:underline">Refresh</button>
      </div>

      {isLoadingHistory ? (
        <LoadingSpinner message="Loading..." />
      ) : history.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">No cycles yet.</p>
      ) : (
        <div className="space-y-1">
          {history.map((entry) => {
            const barWidth = Math.round((entry.durationMs / maxDuration) * 100);
            const colorKey = entry.error ? (entry.entryType === 'escalation' ? 'escalation' : 'error') : entry.success ? 'success' : 'failed';
            const isExpanded = expandedCycle === entry.id;
            const ageMs = now - new Date(entry.executedAt).getTime();
            const ageLabel = ageMs < 60_000 ? 'now' : ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m` : `${Math.floor(ageMs / 3_600_000)}h`;

            return (
              <div key={entry.id} className="border border-border dark:border-dark-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedCycle(isExpanded ? null : entry.id)}
                  className="w-full flex items-center gap-2 p-2.5 hover:bg-primary/5 transition-colors"
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorKey === 'success' ? '#22c55e' : colorKey === 'error' ? '#f59e0b' : colorKey === 'failed' ? '#ef4444' : colorKey === 'escalation' ? '#a855f7' : '#3b82f6' }} />
                  <div className="flex-1 h-5 bg-[#1a1a1a] rounded-sm overflow-hidden">
                    <div className={`h-full ${CYCLE_BAR_COLOR[colorKey] ?? CYCLE_BAR_COLOR.default}`} style={{ width: `${barWidth}%`, opacity: 0.8 }} />
                  </div>
                  <span className="text-xs font-mono text-gray-400 w-12 shrink-0">#{entry.cycleNumber}</span>
                  <span className="text-xs font-mono text-green-400 w-16 shrink-0">{formatCost(entry.costUsd ?? 0)}</span>
                  <span className="text-xs font-mono text-gray-500 w-16 shrink-0">{formatDuration(entry.durationMs)}</span>
                  <span className="text-xs text-gray-600 w-10 shrink-0">{ageLabel}</span>
                  <span className="text-gray-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-[#1a1a1a] bg-[#0d0d0d]">
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3 text-xs font-mono">
                      <div className="bg-[#161616] rounded p-1.5"><span className="text-gray-500">Cycle</span><p className="text-gray-300 font-medium">{entry.cycleNumber}</p></div>
                      <div className="bg-[#161616] rounded p-1.5"><span className="text-gray-500">Duration</span><p className="text-gray-300 font-medium">{formatDuration(entry.durationMs)}</p></div>
                      <div className="bg-[#161616] rounded p-1.5"><span className="text-gray-500">Cost</span><p className="text-gray-300 font-medium">{formatCost(entry.costUsd ?? 0)}</p></div>
                      <div className="bg-[#161616] rounded p-1.5"><span className="text-gray-500">Tools</span><p className="text-gray-300 font-medium">{entry.toolCalls.length}</p></div>
                      {entry.tokensUsed && (
                        <>
                          <div className="bg-[#161616] rounded p-1.5"><span className="text-gray-500">Prompt</span><p className="text-gray-300 font-medium">{entry.tokensUsed.prompt}</p></div>
                          <div className="bg-[#161616] rounded p-1.5"><span className="text-gray-500">Completion</span><p className="text-gray-300 font-medium">{entry.tokensUsed.completion}</p></div>
                        </>
                      )}
                    </div>
                    {entry.outputMessage && (
                      <div className="mt-3">
                        <p className="text-xs text-gray-500 mb-1">Output</p>
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-[#161616] rounded p-2 max-h-32 overflow-y-auto">{entry.outputMessage.slice(0, 1000)}{entry.outputMessage.length > 1000 ? '...' : ''}</pre>
                      </div>
                    )}
                    {entry.error && (
                      <div className="mt-2"><p className="text-xs text-red-400 mb-1">Error</p><p className="text-xs text-red-300/70 font-mono">{entry.error}</p></div>
                    )}
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-1">Tool calls ({entry.toolCalls.length})</p>
                      <div className="space-y-1">
                        {entry.toolCalls.slice(0, 20).map((tc, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs font-mono">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tc.success ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span className="text-blue-400 shrink-0">{tc.tool}</span>
                            <span className={tc.success ? 'text-green-500' : 'text-red-500'}>{tc.success ? 'OK' : 'FAIL'}</span>
                            <span className="text-gray-500">{formatDuration(tc.durationMs ?? 0)}</span>
                            {tc.args && Object.keys(tc.args).length > 0 && (
                              <span className="text-gray-600 truncate">{JSON.stringify(tc.args).slice(0, 40)}</span>
                            )}
                          </div>
                        ))}
                        {entry.toolCalls.length > 20 && <p className="text-xs text-gray-600 pl-4">+{entry.toolCalls.length - 20} more</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Audit
// ============================================================================

export interface AuditEntry {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: string;
  success: boolean;
  durationMs: number;
  category: string;
  cycleNumber: number;
  executedAt: string;
}

const AUDIT_CAT_COLORS: Record<string, string> = {
  claw: 'bg-primary/10 text-primary',
  cli: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  browser: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  'coding-agent': 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  web: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  'code-exec': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  git: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  filesystem: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  knowledge: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  tool: 'bg-gray-500/10 text-gray-500',
};

export function AuditTab({
  auditEntries,
  auditTotal,
  auditFilter,
  setAuditFilter,
  isLoadingAudit,
  loadAudit,
}: {
  auditEntries: AuditEntry[];
  auditTotal: number;
  auditFilter: string;
  setAuditFilter: Dispatch<SetStateAction<string>>;
  isLoadingAudit: boolean;
  loadAudit: (cat?: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">{auditTotal} calls logged</p>
        <div className="flex-1" />
        <input
          type="text"
          placeholder="Search tool..."
          className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary w-32"
          onChange={(e) => setAuditFilter(e.target.value)}
        />
        <select
          value={auditFilter.split(':')[0]}
          onChange={(e) => setAuditFilter(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
        >
          <option value="">All</option>
          <option value="claw">Claw</option>
          <option value="cli">CLI</option>
          <option value="browser">Browser</option>
          <option value="coding-agent">Coding</option>
          <option value="web">Web</option>
          <option value="code-exec">Code</option>
          <option value="git">Git</option>
          <option value="filesystem">FS</option>
          <option value="knowledge">KB</option>
        </select>
        <button onClick={() => loadAudit(auditFilter || undefined)} className="text-xs text-primary hover:underline">Refresh</button>
      </div>

      {isLoadingAudit ? (
        <LoadingSpinner message="Loading audit log..." />
      ) : auditEntries.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">No audit entries yet.</p>
      ) : (
        <div className="space-y-1.5">
          {auditEntries
            .filter((e) => !auditFilter || e.toolName.toLowerCase().includes(auditFilter.toLowerCase()) || e.category === auditFilter)
            .map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary text-xs">
                {entry.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium text-text-primary dark:text-dark-text-primary">{entry.toolName}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${AUDIT_CAT_COLORS[entry.category] ?? AUDIT_CAT_COLORS.tool}`}>{entry.category}</span>
                    <span className="text-text-muted">{`#${entry.cycleNumber}`}</span>
                    <span className="text-text-muted">{formatDuration(entry.durationMs)}</span>
                  </div>
                  {Object.keys(entry.toolArgs).length > 0 && (
                    <p className="text-text-muted dark:text-dark-text-muted mt-0.5 truncate font-mono text-[11px]">{JSON.stringify(entry.toolArgs).slice(0, 100)}</p>
                  )}
                  {!entry.success && entry.toolResult && (
                    <p className="text-red-500 mt-0.5 truncate text-[11px]">{entry.toolResult.slice(0, 80)}</p>
                  )}
                </div>
                <span className="text-text-muted shrink-0 text-[11px]">{timeAgo(entry.executedAt)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Files
// ============================================================================

export function FilesTab({
  claw,
  currentFilePath,
  workspaceFiles,
  isLoadingFiles,
  loadFiles,
  loadFileContent,
  viewingFile,
  setViewingFile,
  fileContent,
  setFileContent,
  onFileSaved,
}: {
  claw: ClawConfig;
  currentFilePath: string;
  workspaceFiles: Array<{ name: string; path: string; isDirectory: boolean; size: number; modifiedAt: string }>;
  isLoadingFiles: boolean;
  loadFiles: (subPath?: string) => void;
  loadFileContent: (filePath: string) => void;
  viewingFile: string | null;
  setViewingFile: Dispatch<SetStateAction<string | null>>;
  fileContent: string | null;
  setFileContent: Dispatch<SetStateAction<string | null>>;
  onFileSaved: () => void;
}) {
  return (
    <div>
      {!claw.workspaceId ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-8 text-center">No workspace assigned.</p>
      ) : (
        <>
          {/* Quick access .claw/ files */}
          <div className="mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-2">.claw/ Directives</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {['INSTRUCTIONS.md', 'TASKS.md', 'MEMORY.md', 'LOG.md'].map((f) => (
                <button
                  key={f}
                  onClick={() => loadFileContent(`.claw/${f}`)}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 font-mono transition-colors"
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  {f}
                </button>
              ))}
            </div>
          </div>

          <FileBrowser
            workspaceId={claw.workspaceId}
            currentPath={currentFilePath}
            files={workspaceFiles}
            isLoading={isLoadingFiles}
            onNavigate={loadFiles}
            onOpenFile={loadFileContent}
            onRefresh={() => loadFiles(currentFilePath)}
            onFileCreated={() => loadFiles(currentFilePath)}
          />
        </>
      )}
      {viewingFile && claw.workspaceId && (
        <FileEditorModal
          workspaceId={claw.workspaceId}
          filePath={viewingFile}
          content={fileContent}
          onClose={() => { setViewingFile(null); setFileContent(null); }}
          onSaved={onFileSaved}
        />
      )}
    </div>
  );
}

// ============================================================================
// Output (Live Terminal)
// ============================================================================

export interface ClawOutputEvent {
  clawId: string;
  message?: string;
  type?: string;
  title?: string;
  summary?: string;
  urgency?: string;
  timestamp: string;
}

const URGENCY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-amber-400',
  normal: 'text-green-400',
  info: 'text-blue-400',
  report: 'text-purple-400',
};

export function OutputTab({ outputFeed }: { outputFeed: ClawOutputEvent[] }) {
  const [isPaused, setIsPaused] = useState(false);
  const [isScrollLocked, setIsScrollLocked] = useState(false);
  const [isCleared, setIsCleared] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayFeed = isCleared ? [] : outputFeed;

  useEffect(() => {
    if (!isScrollLocked && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displayFeed, isScrollLocked, isPaused]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setIsScrollLocked(scrollHeight - scrollTop - clientHeight > 40);
  };

  const copyAll = () => {
    const text = displayFeed.map((e) => `[${e.timestamp}] [${e.type ?? '?'}] [${e.urgency ?? '?'}] ${e.message ?? ''}`).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const urgency = displayFeed[0]?.urgency ?? 'normal';
  const totalUrgencyCounts = displayFeed.reduce<Record<string, number>>((acc, e) => {
    const u = e.urgency ?? 'info';
    acc[u] = (acc[u] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full rounded-lg border border-[#1a1a1a] overflow-hidden">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0d0d0d] border-b border-[#1a1a1a]">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-xs font-mono text-gray-500">claw output</span>
          <span className={`text-xs font-mono ${URGENCY_COLORS[urgency] ?? 'text-gray-400'}`}>
            {displayFeed.length} events
          </span>
          {Object.entries(totalUrgencyCounts).map(([u, n]) => (
            <span key={u} className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${URGENCY_COLORS[u] ?? 'text-gray-500'} bg-${u}/10`}>{n} {u}</span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsScrollLocked((v) => !v)} className={`text-xs px-2 py-1 rounded font-mono border ${isScrollLocked ? 'text-amber-400 border-amber-400/30' : 'text-gray-500 border-gray-700'}`}>
            {isScrollLocked ? '🔒' : '🔓'}
          </button>
          <button onClick={() => setIsPaused((v) => !v)} className={`text-xs px-2 py-1 rounded font-mono border ${isPaused ? 'text-green-400 border-green-400/30' : 'text-gray-500 border-gray-700'}`}>
            {isPaused ? '▶' : '⏸'}
          </button>
          <button onClick={copyAll} className="text-xs px-2 py-1 rounded font-mono text-gray-500 border border-gray-700">📋</button>
          <button onClick={() => setIsCleared(true)} className="text-xs px-2 py-1 rounded font-mono text-gray-500 border border-gray-700 hover:text-red-400">✕</button>
        </div>
      </div>

      {/* Terminal body */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto bg-[#0d0d0d] p-4 font-mono text-sm space-y-0.5" style={{ minHeight: 0 }}>
        {displayFeed.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-600 text-sm">No output yet — claw is initializing...</p>
          </div>
        ) : (
          displayFeed.map((evt, i) => {
            const color = URGENCY_COLORS[evt.urgency ?? 'info'] ?? 'text-gray-300';
            const prefix = evt.type === 'report' ? '📋' : evt.type === 'progress' ? '⚡' : '›';
            return (
              <div key={`${evt.timestamp}-${i}`} className="flex gap-3 group">
                <span className="text-gray-600 shrink-0 text-xs w-28">{timeAgo(evt.timestamp)}</span>
                <span className={`shrink-0 ${color}`}>{prefix}</span>
                <span className={`${color} break-all`}>{evt.message}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ============================================================================
// Conversation
// ============================================================================

export function ConversationTab({
  conversation,
  isLoadingConvo,
}: {
  conversation: Array<{ role: string; content: string; createdAt?: string }>;
  isLoadingConvo: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        Messages from claw_send_output and claw_complete_report. These are the claw's narrative log.
      </p>
      {isLoadingConvo ? (
        <LoadingSpinner message="Loading..." />
      ) : conversation.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          No messages yet. The claw writes here when using claw_send_output or claw_complete_report.
        </p>
      ) : (
        <div className="space-y-3">
          {conversation.map((msg, i) => (
            <div
              key={i}
              className={`p-4 rounded-lg border ${
                msg.role === 'assistant'
                  ? 'bg-primary/5 border-primary/10'
                  : 'bg-bg-secondary dark:bg-dark-bg-secondary border-border dark:border-dark-border'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-bold uppercase ${
                  msg.role === 'assistant' ? 'text-primary' : msg.role === 'system' ? 'text-amber-500' : 'text-text-muted'
                }`}>
                  {msg.role}
                </span>
                {msg.createdAt && <span className="text-xs text-text-muted">{timeAgo(msg.createdAt)}</span>}
              </div>
              <div className="text-sm text-text-primary dark:text-dark-text-primary whitespace-pre-wrap leading-relaxed">
                {msg.content.length > 3000 ? msg.content.slice(0, 3000) + '\n\n...' : msg.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Re-export FileBrowser and FileEditorModal for parent
export { FileBrowser, FileEditorModal };