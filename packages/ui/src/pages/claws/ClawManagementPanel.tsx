import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useGateway } from '../../hooks/useWebSocket';
import { useToast } from '../../components/ToastProvider';
import { clawsApi } from '../../api/endpoints/claws';
import type { ClawConfig, ClawDoctorResponse, ClawHistoryEntry } from '../../api/endpoints/claws';
import { silentCatch } from '../../utils/ignore-error';
import {
  Activity,
  Settings,
  Puzzle,
  FolderOpen,
  FileText,
  Send,
  Bot,
  Zap,
  Wrench,
  X,
  BarChart3,
  Code2,
  Play,
  Pause,
  Square,
  Clock,
  Target,
} from '../../components/icons';
import { authedFetch, getStateBadge, inputClass as ic } from './utils';
import {
  OverviewTab,
  PlanTab,
  StatsTab,
  SettingsTab,
  SkillsTab,
  MemoryTab,
  ConfigTab,
  DoctorTab,
  RunsTab,
  FilesTab,
  OutputTab,
  ConversationTab,
  SchedulesTab,
  type ClawOutputEvent,
  type AuditEntry,
} from './ClawDetailTabs';

// Exported so ClawsPage (and any deep-link consumers) can construct values
// from this union — otherwise the page-side type drifts and you can't pass
// 'plan' as initialTab from a /claws?tab=plan deep link.
export type DetailTab =
  | 'overview'
  | 'plan'
  | 'stats'
  | 'runs'
  | 'doctor'
  | 'schedules'
  | 'settings'
  | 'skills'
  | 'memory'
  | 'config'
  | 'files'
  | 'output'
  | 'conversation';

// Set of valid tab ids — used to validate `?tab=<id>` deep-link params
// without re-listing the union by hand.
const DETAIL_TAB_IDS: readonly DetailTab[] = [
  'overview',
  'plan',
  'stats',
  'runs',
  'doctor',
  'schedules',
  'settings',
  'skills',
  'memory',
  'config',
  'files',
  'output',
  'conversation',
] as const;

export function isDetailTab(value: unknown): value is DetailTab {
  return typeof value === 'string' && (DETAIL_TAB_IDS as readonly string[]).includes(value);
}

const DETAIL_TABS: {
  id: DetailTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'plan', label: 'Plan', icon: Target },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
  { id: 'runs', label: 'Runs', icon: FileText },
  { id: 'doctor', label: 'Doctor', icon: Wrench },
  { id: 'schedules', label: 'Schedules', icon: Clock },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'skills', label: 'Skills', icon: Puzzle },
  { id: 'memory', label: '.claw', icon: FileText },
  { id: 'config', label: 'Config', icon: Code2 },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'output', label: 'Output', icon: Send },
  { id: 'conversation', label: 'Chat', icon: Bot },
];

// Mirror backend stall threshold so we can flag a stuck focus on the tab.
const PANEL_STALL_THRESHOLD = 5;
const PANEL_REFLECT_THRESHOLD = 2;

type TabBadge = {
  count?: number;
  tone: 'neutral' | 'info' | 'warn' | 'danger' | 'attention';
  pulse?: boolean;
  title?: string;
};

const BADGE_TONE_CLASS: Record<TabBadge['tone'], string> = {
  neutral: 'bg-gray-500/15 text-gray-400',
  info: 'bg-blue-500/15 text-blue-400',
  warn: 'bg-amber-500/15 text-amber-400',
  danger: 'bg-red-500/15 text-red-400',
  attention: 'bg-purple-500/15 text-purple-400',
};

export function ClawManagementPanel({
  claw,
  onClose,
  onUpdate,
  initialTab = 'overview',
}: {
  claw: ClawConfig;
  onClose: () => void;
  onUpdate: () => void;
  initialTab?: DetailTab;
}) {
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [history, setHistory] = useState<ClawHistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [outputFeed, setOutputFeed] = useState<ClawOutputEvent[]>([]);
  const [message, setMessage] = useState('');

  // Skills state
  const [availableSkills, setAvailableSkills] = useState<
    Array<{ id: string; name: string; toolCount: number }>
  >([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(claw.skills ?? []);
  const [isSavingSkills, setIsSavingSkills] = useState(false);

  // Conversation state
  const [conversation, setConversation] = useState<
    Array<{ role: string; content: string; createdAt?: string }>
  >([]);
  const [isLoadingConvo, setIsLoadingConvo] = useState(false);

  // Audit state
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilter, setAuditFilter] = useState('');
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // Doctor state
  const [doctor, setDoctor] = useState<ClawDoctorResponse | null>(null);
  const [isLoadingDoctor, setIsLoadingDoctor] = useState(false);
  const [isApplyingDoctorFixes, setIsApplyingDoctorFixes] = useState(false);

  // Files state
  const [workspaceFiles, setWorkspaceFiles] = useState<
    Array<{ name: string; path: string; isDirectory: boolean; size: number; modifiedAt: string }>
  >([]);
  const [currentFilePath, setCurrentFilePath] = useState('');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // Models state
  const [models, setModels] = useState<
    Array<{ id: string; name: string; provider: string; recommended?: boolean }>
  >([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);

  const toast = useToast();
  const { subscribe } = useGateway();

  // Per-tab attention badges — computed from the same live state that drives
  // each tab body. Lets the operator see which tab needs work without opening
  // each one. Counts are intentionally derived (no extra fetches).
  const tabBadges = useMemo<Partial<Record<DetailTab, TabBadge>>>(() => {
    const out: Partial<Record<DetailTab, TabBadge>> = {};
    const tasks = claw.session?.tasks ?? [];
    const session = claw.session;

    // Overview — pulses when escalation pending or consecutive errors crossed
    // the reflection threshold (the runner injects a meta-prompt at that point).
    const consecErrors = session?.consecutiveErrors ?? 0;
    if (session?.state === 'escalation_pending') {
      out.overview = { tone: 'attention', pulse: true, title: 'Escalation pending' };
    } else if (consecErrors >= PANEL_REFLECT_THRESHOLD) {
      out.overview = {
        tone: 'attention',
        pulse: true,
        count: consecErrors,
        title: `Reflection: ${consecErrors} consecutive errors`,
      };
    } else if (session?.state === 'failed') {
      out.overview = { tone: 'danger', title: 'Run failed' };
    }

    // Plan — shows total open work; warns if focus task has stalled.
    if (tasks.length > 0) {
      const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
      const blocked = tasks.filter((t) => t.status === 'blocked').length;
      const focus = tasks.find((t) => t.status === 'in_progress');
      const stalled = focus !== undefined && (focus.cyclesInProgress ?? 0) >= PANEL_STALL_THRESHOLD;
      const open = inProgress + blocked;
      if (stalled) {
        out.plan = {
          tone: 'danger',
          pulse: true,
          count: focus!.cyclesInProgress ?? 0,
          title: `Focus stalled: ${focus!.cyclesInProgress ?? 0} cycles on "${focus!.title}"`,
        };
      } else if (blocked > 0) {
        out.plan = {
          tone: 'warn',
          count: blocked,
          title: `${blocked} blocked task${blocked === 1 ? '' : 's'}`,
        };
      } else if (open > 0) {
        out.plan = {
          tone: 'info',
          count: open,
          title: `${inProgress} in progress${blocked > 0 ? `, ${blocked} blocked` : ''}`,
        };
      }
    }

    // Doctor — shows recommended fix count when the diagnostics have run.
    const fixCount = doctor ? Object.keys(doctor.patch).length : 0;
    if (fixCount > 0) {
      out.doctor = {
        tone: 'warn',
        count: fixCount,
        title: `${fixCount} suggested fix${fixCount === 1 ? '' : 'es'}`,
      };
    } else if (claw.health && claw.health.status !== 'healthy' && claw.health.status !== 'idle') {
      out.doctor = {
        tone: 'warn',
        pulse: true,
        title: `Health: ${claw.health.status}`,
      };
    }

    // Output — live event stream count. Dot pulses when the most recent event
    // is urgent so the operator notices without watching the feed.
    if (outputFeed.length > 0) {
      const last = outputFeed[outputFeed.length - 1];
      const isUrgent = last?.urgency === 'urgent' || last?.urgency === 'high';
      out.output = {
        tone: isUrgent ? 'danger' : 'info',
        pulse: isUrgent,
        count: outputFeed.length,
        title: `${outputFeed.length} live events`,
      };
    }

    // Runs — surfaces the loaded history total. Stays neutral; it's a count
    // not an alert.
    if (historyTotal > 0) {
      out.runs = {
        tone: 'neutral',
        count: historyTotal > 99 ? 99 : historyTotal,
        title: `${historyTotal} cycle${historyTotal === 1 ? '' : 's'} recorded`,
      };
    }

    // Files — workspace artifact count from the session.
    const artifactCount = session?.artifacts.length ?? 0;
    if (artifactCount > 0) {
      out.files = {
        tone: 'neutral',
        count: artifactCount > 99 ? 99 : artifactCount,
        title: `${artifactCount} artifact${artifactCount === 1 ? '' : 's'} emitted`,
      };
    }

    // Skills — selection count so the operator can confirm config without
    // opening the tab.
    const selectedCount = selectedSkills.length;
    if (selectedCount > 0) {
      out.skills = {
        tone: 'neutral',
        count: selectedCount,
        title: `${selectedCount} skill${selectedCount === 1 ? '' : 's'} attached`,
      };
    }

    return out;
  }, [claw, doctor, outputFeed, historyTotal, selectedSkills]);

  const approveEscalation = async (id: string) => {
    try {
      await clawsApi.approveEscalation(id);
      toast.success('Escalation approved');
      onUpdate();
    } catch {
      toast.error('Failed to approve escalation');
    }
  };

  const denyEscalation = async (id: string) => {
    try {
      await clawsApi.denyEscalation(id);
      toast.success('Escalation denied — claw resumed without the request');
      onUpdate();
    } catch {
      toast.error('Failed to deny escalation');
    }
  };

  // Reset state when claw changes
  useEffect(() => {
    setHistory([]);
    setHistoryTotal(0);
    setOutputFeed([]);
    setTab(initialTab);
    setSelectedSkills(claw.skills ?? []);
    setWorkspaceFiles([]);
    setCurrentFilePath('');
    setFileContent(null);
    setViewingFile(null);
    setConversation([]);
    setAuditEntries([]);
    setAuditTotal(0);
    setAuditFilter('');
    setDoctor(null);
  }, [claw.id, initialTab]);

  // WS output feed
  useEffect(() => {
    const unsub = subscribe<ClawOutputEvent>('claw.output', (p) => {
      if (p.clawId === claw.id) setOutputFeed((prev) => [p, ...prev].slice(0, 200));
    });
    return () => unsub();
  }, [subscribe, claw.id]);

  // Live plan updates — when the agent (or another operator) edits the
  // structured plan, refresh the claw so the Plan tab and the card see the
  // change without the operator hitting reload. We re-fetch instead of
  // applying the WS payload directly to keep `claw` as a single source of
  // truth (the WS event carries enough to update locally, but doing a full
  // re-fetch also syncs cyclesInProgress ticks and reflection state without
  // building a second update path).
  useEffect(() => {
    const unsub = subscribe<{ clawId: string }>('claw:plan:updated', (p) => {
      if (p.clawId === claw.id) onUpdate();
    });
    return () => unsub();
  }, [subscribe, claw.id, onUpdate]);

  // Load history + audit on runs tab switch
  useEffect(() => {
    if (tab === 'runs') {
      loadHistory();
      loadAudit(auditFilter || undefined);
    }
  }, [tab, claw.id, auditFilter]);

  const loadAudit = useCallback(
    async (cat?: string) => {
      setIsLoadingAudit(true);
      try {
        const result = await clawsApi.getAuditLog(claw.id, 50, 0, cat || undefined);
        setAuditEntries(result.entries);
        setAuditTotal(result.total);
      } catch {
        /* ignore */
      } finally {
        setIsLoadingAudit(false);
      }
    },
    [claw.id]
  );

  const loadDoctor = useCallback(async () => {
    setIsLoadingDoctor(true);
    try {
      setDoctor(await clawsApi.doctor(claw.id));
    } catch {
      toast.error('Failed to load doctor report');
    } finally {
      setIsLoadingDoctor(false);
    }
  }, [claw.id, toast]);

  useEffect(() => {
    if (tab === 'doctor') loadDoctor();
  }, [tab, claw.id, loadDoctor]);

  // Load conversation on conversation tab
  useEffect(() => {
    if (tab === 'conversation') {
      setIsLoadingConvo(true);
      authedFetch(`/api/v1/chat/history/claw-${claw.id}?limit=50`)
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((body) => setConversation(body.messages ?? []))
        .catch(() => setConversation([]))
        .finally(() => setIsLoadingConvo(false));
    }
  }, [tab, claw.id]);

  // Load files on files tab
  const loadFiles = useCallback(
    async (subPath = '') => {
      if (!claw.workspaceId) return;
      setIsLoadingFiles(true);
      try {
        const { fileWorkspacesApi } = await import('../../api/endpoints/misc');
        const data = await fileWorkspacesApi.files(claw.workspaceId, subPath || undefined);
        setWorkspaceFiles(data.files ?? []);
        setCurrentFilePath(subPath);
        setFileContent(null);
        setViewingFile(null);
      } catch {
        toast.error('Failed to load files');
      } finally {
        setIsLoadingFiles(false);
      }
    },
    [claw.workspaceId, toast]
  );

  const loadFileContent = async (filePath: string) => {
    if (!claw.workspaceId) return;
    try {
      const res = await authedFetch(
        `/api/v1/file-workspaces/${claw.workspaceId}/file/${filePath}?raw=true`
      );
      if (!res.ok) {
        setFileContent('(failed to read file)');
        return;
      }
      const text = await res.text();
      setFileContent(text);
      setViewingFile(filePath);
    } catch {
      setFileContent('(failed to read file)');
    }
  };

  useEffect(() => {
    if (tab === 'files' && workspaceFiles.length === 0 && claw.workspaceId) loadFiles();
  }, [tab, claw.workspaceId]);

  // Load models on settings tab
  useEffect(() => {
    if ((tab === 'settings' || tab === 'overview') && models.length === 0) {
      import('../../api/endpoints/models')
        .then(({ modelsApi }) =>
          modelsApi.list().then((data) => {
            setModels(data.models);
            setConfiguredProviders(data.configuredProviders);
          })
        )
        .catch(silentCatch('clawMgmt.models'));
    }
  }, [tab]);

  // Load skills on tab switch
  useEffect(() => {
    if (tab === 'skills' && availableSkills.length === 0) {
      import('../../api/endpoints/extensions')
        .then(({ extensionsApi }) =>
          extensionsApi
            .list({ status: 'enabled' })
            .then((exts) =>
              setAvailableSkills(
                exts.map((e) => ({ id: e.id, name: e.name, toolCount: e.toolCount }))
              )
            )
        )
        .catch(silentCatch('clawMgmt.extensions'));
    }
  }, [tab]);

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const { entries, total } = await clawsApi.getHistory(claw.id, 20);
      setHistory(entries);
      setHistoryTotal(total);
    } catch {
      toast.error('Failed to load history');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const sendMsg = async () => {
    if (!message.trim()) return;
    try {
      await clawsApi.sendMessage(claw.id, message.trim());
      toast.success('Message sent');
      setMessage('');
    } catch {
      toast.error('Failed to send');
    }
  };

  const saveSkills = async () => {
    setIsSavingSkills(true);
    try {
      await clawsApi.update(claw.id, { skills: selectedSkills });
      toast.success('Skills updated');
      onUpdate();
    } catch {
      toast.error('Failed to update skills');
    } finally {
      setIsSavingSkills(false);
    }
  };

  const applyDoctorFixes = async () => {
    setIsApplyingDoctorFixes(true);
    try {
      const result = await clawsApi.applyRecommendations(claw.id);
      toast.success(
        result.applied.length > 0
          ? `Applied ${result.applied.length} safe fix${result.applied.length === 1 ? '' : 'es'}`
          : 'No safe fixes needed'
      );
      setDoctor({
        health: result.health,
        patch: {},
        applied: [],
        skipped: result.skipped,
      });
      onUpdate();
    } catch {
      toast.error('Failed to apply safe fixes');
    } finally {
      setIsApplyingDoctorFixes(false);
    }
  };

  const badge = getStateBadge(claw.session?.state ?? null);
  const state = claw.session?.state ?? null;
  const isRunning = state === 'running' || state === 'starting' || state === 'waiting';
  const isPaused = state === 'paused';
  const session = claw.session;

  return (
    <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-sm animate-fade-in-up overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border dark:border-dark-border flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Zap className="w-4 h-4 text-primary shrink-0" />
          {isRunning && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
          )}
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary truncate">
            {claw.name}
          </h3>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${badge.classes}`}
          >
            {badge.text}
          </span>
          {session && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted ml-1">
              <span title="Cycles">{session.cyclesCompleted}c</span>
              <span className="text-border dark:text-dark-border">·</span>
              <span title="Tool calls">{session.totalToolCalls}t</span>
              <span className="text-border dark:text-dark-border">·</span>
              <span title="Cost">${session.totalCostUsd.toFixed(3)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isRunning && !isPaused && (
            <button
              onClick={() => clawsApi.start(claw.id).then(() => onUpdate())}
              className="p-1.5 rounded hover:bg-green-500/10 transition-colors"
              title="Start"
            >
              <Play className="w-4 h-4 text-green-600 dark:text-green-400" />
            </button>
          )}
          {isRunning && (
            <>
              <button
                onClick={() => clawsApi.pause(claw.id).then(() => onUpdate())}
                className="p-1.5 rounded hover:bg-amber-500/10 transition-colors"
                title="Pause"
              >
                <Pause className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              </button>
              <button
                onClick={() => clawsApi.stop(claw.id).then(() => onUpdate())}
                className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
                title="Stop"
              >
                <Square className="w-4 h-4 text-red-600 dark:text-red-400" />
              </button>
            </>
          )}
          {isPaused && (
            <button
              onClick={() => clawsApi.resume(claw.id).then(() => onUpdate())}
              className="p-1.5 rounded hover:bg-green-500/10 transition-colors"
              title="Resume"
            >
              <Play className="w-4 h-4 text-green-600 dark:text-green-400" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
            title="Close"
          >
            <X className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          </button>
        </div>
      </div>

      {/* Body: vertical sidebar + scrollable content */}
      <div className="flex" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {/* Sidebar tabs */}
        <div className="w-36 shrink-0 border-r border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary overflow-y-auto">
          {DETAIL_TABS.map((t) => {
            const badge = tabBadges[t.id];
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors text-left ${
                  tab === t.id
                    ? 'bg-bg-primary dark:bg-dark-bg-primary text-primary border-r-2 border-primary'
                    : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border-r-2 border-transparent'
                }`}
              >
                <t.icon className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 truncate">{t.label}</span>
                {badge && (
                  <span
                    className={`shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-mono font-semibold ${BADGE_TONE_CLASS[badge.tone]} ${
                      badge.pulse ? 'animate-pulse' : ''
                    }`}
                    title={badge.title ?? `${badge.count ?? ''}`}
                  >
                    {badge.count !== undefined ? badge.count : '•'}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {tab === 'overview' && (
            <OverviewTab
              claw={claw}
              message={message}
              setMessage={setMessage}
              sendMsg={sendMsg}
              onApproveEscalation={approveEscalation}
              onDenyEscalation={denyEscalation}
              onSwitchToFiles={() => setTab('files')}
              inputClass={ic}
            />
          )}

          {tab === 'settings' && (
            <SettingsTab
              claw={claw}
              models={models}
              configuredProviders={configuredProviders}
              onSaved={onUpdate}
            />
          )}

          {tab === 'skills' && (
            <SkillsTab
              availableSkills={availableSkills}
              selectedSkills={selectedSkills}
              setSelectedSkills={setSelectedSkills}
              saveSkills={saveSkills}
              isSavingSkills={isSavingSkills}
            />
          )}

          {tab === 'plan' && <PlanTab claw={claw} onPlanChanged={onUpdate} />}

          {tab === 'stats' && <StatsTab claw={claw} />}

          {tab === 'memory' && <MemoryTab claw={claw} />}

          {tab === 'config' && <ConfigTab claw={claw} />}

          {tab === 'runs' && (
            <RunsTab
              clawId={claw.id}
              history={history}
              historyTotal={historyTotal}
              isLoadingHistory={isLoadingHistory}
              loadHistory={loadHistory}
              auditEntries={auditEntries}
              auditTotal={auditTotal}
              auditFilter={auditFilter}
              setAuditFilter={setAuditFilter}
              isLoadingAudit={isLoadingAudit}
              loadAudit={loadAudit}
            />
          )}

          {tab === 'doctor' && (
            <DoctorTab
              claw={claw}
              doctor={doctor}
              isLoadingDoctor={isLoadingDoctor}
              isApplyingDoctorFixes={isApplyingDoctorFixes}
              loadDoctor={loadDoctor}
              applyDoctorFixes={applyDoctorFixes}
            />
          )}

          {tab === 'schedules' && <SchedulesTab claw={claw} />}

          {tab === 'files' && (
            <FilesTab
              claw={claw}
              currentFilePath={currentFilePath}
              workspaceFiles={workspaceFiles}
              isLoadingFiles={isLoadingFiles}
              loadFiles={loadFiles}
              loadFileContent={loadFileContent}
              viewingFile={viewingFile}
              setViewingFile={setViewingFile}
              fileContent={fileContent}
              setFileContent={setFileContent}
              onFileSaved={() => {
                toast.success('File saved');
                loadFiles(currentFilePath);
              }}
            />
          )}

          {tab === 'output' && <OutputTab outputFeed={outputFeed} />}

          {tab === 'conversation' && (
            <ConversationTab conversation={conversation} isLoadingConvo={isLoadingConvo} />
          )}
        </div>
      </div>
    </div>
  );
}
