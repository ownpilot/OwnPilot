/**
 * Orchestration Page
 *
 * Multi-step CLI tool orchestration. Set a goal, pick a provider (Claude/Gemini/Codex),
 * and let OwnPilot chain sessions together — analyzing output and deciding next steps.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../components/ToastProvider';
import {
  Play,
  StopCircle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Terminal,
  AlertCircle,
  Send,
  Zap,
  FolderOpen,
  Trash2,
} from '../components/icons';
import {
  orchestrationApi,
  codingAgentsApi,
  type OrchestrationRun,
  type OrchestrationStep,
  type CodingAgentStatus,
} from '../api/endpoints/coding-agents';
import { fileWorkspacesApi, type FileWorkspaceInfo } from '../api/endpoints';
import { useGateway } from '../hooks/useWebSocket';

// =============================================================================
// Status badge
// =============================================================================

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  planning: { bg: 'bg-blue-500/15', text: 'text-blue-500', label: 'Planning' },
  running: { bg: 'bg-primary/15', text: 'text-primary', label: 'Running' },
  waiting_user: { bg: 'bg-amber-500/15', text: 'text-amber-500', label: 'Waiting' },
  paused: { bg: 'bg-gray-500/15', text: 'text-gray-500', label: 'Paused' },
  completed: { bg: 'bg-success/15', text: 'text-success', label: 'Completed' },
  failed: { bg: 'bg-error/15', text: 'text-error', label: 'Failed' },
  cancelled: { bg: 'bg-gray-500/15', text: 'text-gray-500', label: 'Cancelled' },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { bg: 'bg-gray-500/15', text: 'text-gray-500', label: status };
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

// =============================================================================
// Live output viewer — streams CLI output for the active step
// =============================================================================

function LiveOutput({
  sessionId,
  send,
  subscribe,
}: {
  sessionId: string;
  send: <T>(type: string, payload: T) => void;
  subscribe: <T>(event: string, handler: (data: T) => void) => () => void;
}) {
  const [output, setOutput] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll when output changes
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output]);

  // Handle scroll to detect manual scroll-up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  // Subscribe to session output
  useEffect(() => {
    // Subscribe via WS to get output stream
    send('coding-agent:subscribe', { sessionId });
    const resubTimer = setTimeout(() => send('coding-agent:subscribe', { sessionId }), 500);

    const unsub = subscribe<{ sessionId: string; data: string }>(
      'coding-agent:session:output',
      (payload) => {
        if (payload.sessionId === sessionId) {
          setOutput((prev) => {
            const next = prev + payload.data;
            // Cap at 200KB to prevent memory issues
            return next.length > 200_000 ? next.slice(-200_000) : next;
          });
        }
      }
    );

    return () => {
      clearTimeout(resubTimer);
      unsub();
    };
  }, [sessionId, send, subscribe]);

  return (
    <div className="border border-border dark:border-dark-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary border-b border-border dark:border-dark-border">
        <Terminal className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-semibold text-text-muted dark:text-dark-text-muted uppercase">
          Live Output
        </span>
        <div className="w-2 h-2 rounded-full bg-success animate-pulse ml-auto" />
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-56 overflow-y-auto bg-gray-950 p-3 font-mono text-xs text-green-400 whitespace-pre-wrap break-all"
      >
        {output || (
          <span className="text-gray-600">Waiting for output...</span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Step timeline
// =============================================================================

function StepTimeline({ steps }: { steps: OrchestrationStep[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (steps.length === 0) {
    return (
      <p className="text-xs text-text-muted dark:text-dark-text-muted py-4 text-center">
        No steps executed yet
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {steps.map((step) => (
        <div key={step.index} className="border border-border dark:border-dark-border rounded-lg">
          <button
            onClick={() => setExpanded(expanded === step.index ? null : step.index)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left"
          >
            {step.status === 'completed' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
            ) : step.status === 'running' ? (
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
            ) : step.status === 'failed' ? (
              <XCircle className="w-3.5 h-3.5 text-error shrink-0" />
            ) : (
              <Clock className="w-3.5 h-3.5 text-text-muted shrink-0" />
            )}

            <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary flex-1 truncate">
              Step {step.index + 1}
              {step.analysis?.summary && (
                <span className="font-normal text-text-muted dark:text-dark-text-muted ml-1.5">
                  — {step.analysis.summary}
                </span>
              )}
            </span>

            {step.durationMs != null && (
              <span className="text-[10px] text-text-muted shrink-0">
                {(step.durationMs / 1000).toFixed(1)}s
              </span>
            )}

            {expanded === step.index ? (
              <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
            )}
          </button>

          {expanded === step.index && (
            <div className="px-3 pb-3 space-y-2 border-t border-border dark:border-dark-border pt-2">
              <div>
                <div className="text-[10px] font-semibold text-text-muted dark:text-dark-text-muted uppercase mb-0.5">
                  Prompt
                </div>
                <p className="text-xs text-text-primary dark:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary rounded p-2 whitespace-pre-wrap">
                  {step.prompt}
                </p>
              </div>
              {step.analysis && (
                <div>
                  <div className="text-[10px] font-semibold text-text-muted dark:text-dark-text-muted uppercase mb-0.5">
                    Analysis
                  </div>
                  <div className="text-xs space-y-1">
                    <p className="text-text-primary dark:text-dark-text-primary">
                      {step.analysis.summary}
                    </p>
                    {step.analysis.hasErrors && step.analysis.errors?.length ? (
                      <div className="text-error">
                        Errors: {step.analysis.errors.join(', ')}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-3 text-text-muted">
                      <span>
                        Confidence: {Math.round(step.analysis.confidence * 100)}%
                      </span>
                      <span>
                        Goal complete: {step.analysis.goalComplete ? 'Yes' : 'No'}
                      </span>
                    </div>
                    {step.analysis.nextPrompt && (
                      <div>
                        <span className="text-text-muted">Next: </span>
                        <span className="text-text-secondary dark:text-dark-text-secondary">
                          {step.analysis.nextPrompt}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// New run form
// =============================================================================

function NewRunForm({
  providers,
  workspaces,
  onStart,
}: {
  providers: CodingAgentStatus[];
  workspaces: FileWorkspaceInfo[];
  onStart: (goal: string, provider: string, cwd: string, autoMode: boolean) => void;
}) {
  const [goal, setGoal] = useState('');
  const [provider, setProvider] = useState('claude-code');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [subPath, setSubPath] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [useManual, setUseManual] = useState(workspaces.length === 0);
  const [autoMode, setAutoMode] = useState(false);

  const installedProviders = providers.filter((p) => p.installed);
  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);

  // Resolve the final working directory
  const resolvedCwd = useManual
    ? manualPath.trim()
    : selectedWorkspace
      ? subPath
        ? `${selectedWorkspace.path}/${subPath}`.replace(/\/+/g, '/').replace(/\/$/, '')
        : selectedWorkspace.path
      : '';

  // Basic path validation hint (real validation happens server-side)
  const pathWarning = resolvedCwd && useManual
    ? !/^([A-Za-z]:\\|\/[a-zA-Z])/.test(resolvedCwd)
      ? 'Path should be absolute (e.g. D:\\Projects\\... or /home/...)'
      : null
    : null;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
          Goal
        </label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Describe the overall goal — e.g., Build a REST API for user management with authentication, tests, and documentation"
          rows={3}
          className="w-full px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
            CLI Tool
          </label>
          <div className="relative">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full appearance-none px-3 py-2 pr-8 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {installedProviders.map((p) => (
                <option key={p.provider} value={p.provider}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary">
              Working Directory
            </label>
            {workspaces.length > 0 && (
              <button
                type="button"
                onClick={() => setUseManual((v) => !v)}
                className="text-[10px] text-primary hover:text-primary/80 transition-colors"
              >
                {useManual ? 'Use workspace' : 'Enter path manually'}
              </button>
            )}
          </div>

          {useManual ? (
            <input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="D:\Projects\my-app  or  /home/user/my-app"
              className="w-full px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <select
                  value={selectedWorkspaceId}
                  onChange={(e) => {
                    setSelectedWorkspaceId(e.target.value);
                    setSubPath('');
                  }}
                  className="w-full appearance-none px-3 py-2 pr-8 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select workspace...</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name ? `${w.name} — ${w.path}` : w.path}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
              </div>

              {selectedWorkspace && (
                <input
                  value={subPath}
                  onChange={(e) => setSubPath(e.target.value.replace(/\\/g, '/'))}
                  placeholder="subfolder (optional) — e.g., packages/api"
                  className="w-full px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Resolved path preview */}
      {resolvedCwd && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50 rounded-lg border border-border/50 dark:border-dark-border/50">
            <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-xs font-mono text-text-secondary dark:text-dark-text-secondary truncate">
              {resolvedCwd}
            </span>
          </div>
          {pathWarning && (
            <div className="flex items-center gap-1.5 px-2">
              <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="text-[10px] text-amber-500">{pathWarning}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoMode}
            onChange={(e) => setAutoMode(e.target.checked)}
            className="w-4 h-4 rounded border-border dark:border-dark-border accent-primary"
          />
          <span className="text-xs text-text-secondary dark:text-dark-text-secondary">
            Full auto-mode
            <span className="text-text-muted dark:text-dark-text-muted ml-1">
              (continue without asking)
            </span>
          </span>
        </label>

        <button
          onClick={() => goal.trim() && resolvedCwd && !pathWarning && onStart(goal, provider, resolvedCwd, autoMode)}
          disabled={!goal.trim() || !resolvedCwd || !!pathWarning}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Zap className="w-4 h-4" />
          Start Orchestration
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Main page
// =============================================================================

export function OrchestrationPage() {
  const toast = useToast();
  const gateway = useGateway();

  const [runs, setRuns] = useState<OrchestrationRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [providers, setProviders] = useState<CodingAgentStatus[]>([]);
  const [workspaces, setWorkspaces] = useState<FileWorkspaceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [continuePrompt, setContinuePrompt] = useState('');
  const [isContinuing, setIsContinuing] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  // When selecting a run, detect if there's already a running step with a sessionId
  useEffect(() => {
    if (!selectedRun || selectedRun.status !== 'running') {
      setActiveSessionId(null);
      return;
    }
    const runningStep = selectedRun.steps.find((s) => s.status === 'running');
    if (runningStep?.sessionId) {
      setActiveSessionId(runningStep.sessionId);
    }
  }, [selectedRunId]);

  const fetchRuns = useCallback(async () => {
    try {
      const { runs: data } = await orchestrationApi.list();
      setRuns(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const data = await codingAgentsApi.status();
      setProviders(data);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const { workspaces: data } = await fileWorkspacesApi.list();
      setWorkspaces(data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    fetchProviders();
    fetchWorkspaces();
  }, [fetchRuns, fetchProviders, fetchWorkspaces]);

  // WebSocket real-time updates
  useEffect(() => {
    if (!gateway) return;

    const events = [
      'orchestration:created',
      'orchestration:status',
      'orchestration:step:analyzed',
      'orchestration:waiting',
      'orchestration:finished',
      'orchestration:cancelled',
      'orchestration:continued',
      'orchestration:error',
    ];

    const unsubscribers = events.map((e) => gateway.subscribe(e, () => fetchRuns()));

    // Track active session for live output
    unsubscribers.push(
      gateway.subscribe<{ id: string; sessionId?: string }>(
        'orchestration:step:started',
        (payload) => {
          if (payload.sessionId && payload.id === selectedRunId) {
            setActiveSessionId(payload.sessionId);
          }
          fetchRuns();
        }
      )
    );

    // Clear active session when step completes
    unsubscribers.push(
      gateway.subscribe('orchestration:step:completed', () => {
        setActiveSessionId(null);
        fetchRuns();
      })
    );

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [gateway, fetchRuns, selectedRunId]);

  const handleStart = async (
    goal: string,
    provider: string,
    cwd: string,
    autoMode: boolean
  ) => {
    try {
      const { run } = await orchestrationApi.start({ goal, provider, cwd, autoMode });
      toast.success('Orchestration started');
      setShowNewForm(false);
      setSelectedRunId(run.id);
      await fetchRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start');
    }
  };

  const handleContinue = async () => {
    if (!selectedRunId || !continuePrompt.trim()) return;
    setIsContinuing(true);
    try {
      await orchestrationApi.continue(selectedRunId, continuePrompt);
      setContinuePrompt('');
      toast.success('Continuing...');
      await fetchRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to continue');
    } finally {
      setIsContinuing(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await orchestrationApi.cancel(id);
      toast.success('Orchestration cancelled');
      await fetchRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await orchestrationApi.delete(id);
      toast.success('Run deleted');
      if (selectedRunId === id) setSelectedRunId(null);
      await fetchRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Orchestration
            </h2>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Multi-step CLI tool automation — goal in, results out
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchRuns}
            className="p-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-text-muted" />
          </button>
          <button
            onClick={() => setShowNewForm((s) => !s)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Play className="w-4 h-4" />
            New Run
          </button>
        </div>
      </header>

      {/* New run form */}
      {showNewForm && (
        <div className="px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
          <NewRunForm
            providers={providers}
            workspaces={workspaces}
            onStart={handleStart}
          />
        </div>
      )}

      {/* Body — split: run list | run detail */}
      <div className="flex flex-1 min-h-0">
        {/* Left: run list */}
        <div className="w-72 shrink-0 border-r border-border dark:border-dark-border overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-8">
              <Terminal className="w-8 h-8 mx-auto mb-2 text-text-muted/30" />
              <p className="text-xs text-text-muted">No orchestration runs yet</p>
            </div>
          ) : (
            <div className="py-1">
              {runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={`w-full px-4 py-3 text-left border-b border-border dark:border-dark-border transition-colors ${
                    selectedRunId === run.id
                      ? 'bg-primary/5 border-l-2 border-l-primary'
                      : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary truncate flex-1">
                      {run.goal.slice(0, 50)}
                      {run.goal.length > 50 ? '...' : ''}
                    </span>
                    <StatusBadge status={run.status} />
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-text-muted">
                    <span>{run.provider}</span>
                    <span>·</span>
                    <span>
                      {run.steps.length}/{run.maxSteps} steps
                    </span>
                    {run.totalDurationMs && (
                      <>
                        <span>·</span>
                        <span>{(run.totalDurationMs / 1000).toFixed(0)}s</span>
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: run detail */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedRun ? (
            <>
              {/* Run header */}
              <div className="px-5 py-3 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={selectedRun.status} />
                      <span className="text-[10px] text-text-muted font-mono">
                        {selectedRun.id}
                      </span>
                    </div>
                    <p className="text-sm text-text-primary dark:text-dark-text-primary">
                      {selectedRun.goal}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted">
                      <span>Provider: {selectedRun.provider}</span>
                      <span>Workspace: {selectedRun.cwd}</span>
                      <span>
                        Mode: {selectedRun.autoMode ? 'Full auto' : 'Step-by-step'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {['running', 'planning', 'waiting_user'].includes(selectedRun.status) && (
                      <button
                        onClick={() => handleCancel(selectedRun.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-error hover:bg-error/10 rounded-lg transition-colors"
                      >
                        <StopCircle className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    )}
                    {['completed', 'failed', 'cancelled'].includes(selectedRun.status) && (
                      <button
                        onClick={() => handleDelete(selectedRun.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-error hover:bg-error/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Steps timeline + live output */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <StepTimeline steps={selectedRun.steps} />

                {/* Live CLI output for the active step */}
                {activeSessionId && selectedRun.status === 'running' && (
                  <LiveOutput
                    sessionId={activeSessionId}
                    send={gateway.send}
                    subscribe={gateway.subscribe}
                  />
                )}
              </div>

              {/* Continue input (when waiting for user) */}
              {selectedRun.status === 'waiting_user' && (
                <div className="px-5 py-3 border-t border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
                  {(() => {
                    const lastSt = selectedRun.steps[selectedRun.steps.length - 1];
                    const question = lastSt?.analysis?.userQuestion;
                    if (!question) return null;
                    return (
                      <div className="flex items-start gap-2 mb-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">{question}</p>
                      </div>
                    );
                  })()}
                  <div className="flex items-center gap-2">
                    <input
                      value={continuePrompt}
                      onChange={(e) => setContinuePrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleContinue();
                        }
                      }}
                      placeholder="Type your response or next instruction..."
                      className="flex-1 px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <button
                      onClick={handleContinue}
                      disabled={!continuePrompt.trim() || isContinuing}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {isContinuing ? 'Sending...' : 'Continue'}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Zap className="w-12 h-12 mx-auto mb-3 text-text-muted/20" />
                <p className="text-sm text-text-muted dark:text-dark-text-muted">
                  Select a run or start a new orchestration
                </p>
                <p className="text-xs text-text-muted/60 mt-1 max-w-sm mx-auto">
                  Set a goal, pick a CLI tool (Claude Code, Codex, Gemini), and let OwnPilot
                  chain sessions together — analyzing output and deciding next steps automatically.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
