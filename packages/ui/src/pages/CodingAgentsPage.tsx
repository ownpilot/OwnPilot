/**
 * Coding Agents Page
 *
 * Interactive terminal sessions for external AI coding agents
 * (Claude Code, Codex, Gemini CLI). Split panel layout:
 * left sidebar for session list + provider status,
 * right panel for live xterm.js terminal.
 */

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Terminal,
  Plus,
  Play,
  StopCircle,
  Trash2,
  ChevronDown,
  ChevronRight,
  Clock,
  Key,
  AlertCircle,
} from '../components/icons';
import { XTerminal } from '../components/XTerminal';
import { AutoModePanel } from '../components/AutoModePanel';
import { codingAgentsApi, fileWorkspacesApi } from '../api';
import type {
  CodingAgentStatus,
  CodingAgentSession,
  CodingAgentSessionState,
  CodingAgentResultRecord,
} from '../api/endpoints/coding-agents';
import type { FileWorkspaceInfo } from '../api/endpoints';
import { useGateway } from '../hooks/useWebSocket';

// =============================================================================
// Provider metadata
// =============================================================================

interface ProviderMeta {
  icon: string;
  description: string;
  installCommand?: string;
  installNote?: string;
  docsUrl: string;
  docsLabel: string;
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  'claude-code': {
    icon: 'C',
    description: 'Anthropic Claude Code — complex multi-file changes and refactoring.',
    installNote: 'npm i -g @anthropic-ai/claude-code',
    docsUrl: 'https://console.anthropic.com',
    docsLabel: 'console.anthropic.com',
  },
  codex: {
    icon: 'O',
    description: 'OpenAI Codex CLI — code generation and test writing.',
    installCommand: 'npm i -g @openai/codex',
    docsUrl: 'https://platform.openai.com',
    docsLabel: 'platform.openai.com',
  },
  'gemini-cli': {
    icon: 'G',
    description: 'Google Gemini CLI — code analysis and explanation.',
    installCommand: 'npm i -g @google/gemini-cli',
    docsUrl: 'https://aistudio.google.com',
    docsLabel: 'aistudio.google.com',
  },
};

const PROVIDER_COLORS: Record<string, string> = {
  'claude-code': 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
  codex: 'bg-green-500/20 text-green-600 dark:text-green-400',
  'gemini-cli': 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
};

const STATE_COLORS: Record<CodingAgentSessionState, string> = {
  starting: 'bg-yellow-500',
  running: 'bg-green-500',
  waiting: 'bg-yellow-500',
  completed: 'bg-gray-400 dark:bg-gray-600',
  failed: 'bg-red-500',
  terminated: 'bg-gray-400 dark:bg-gray-600',
};

const STATE_LABELS: Record<CodingAgentSessionState, string> = {
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting',
  completed: 'Completed',
  failed: 'Failed',
  terminated: 'Terminated',
};

// =============================================================================
// Main Component
// =============================================================================

export function CodingAgentsPage() {
  const toast = useToast();
  const { subscribe } = useGateway();

  // State
  const [sessions, setSessions] = useState<CodingAgentSession[]>([]);
  const [statuses, setStatuses] = useState<CodingAgentStatus[]>([]);
  const [results, setResults] = useState<CodingAgentResultRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showProviders, setShowProviders] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Fetch data
  const fetchAll = useCallback(async () => {
    try {
      setIsLoading(true);
      const [sessionsData, statusData, resultsData] = await Promise.all([
        codingAgentsApi.listSessions(),
        codingAgentsApi.status(),
        codingAgentsApi.listResults(1, 20).catch(() => ({ data: [] })),
      ]);
      setSessions(sessionsData);
      setStatuses(statusData);
      setResults(resultsData.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Listen for session state changes via WS
  useEffect(() => {
    const unsubCreated = subscribe<{ session: CodingAgentSession }>(
      'coding-agent:session:created',
      (payload) => {
        setSessions((prev) => {
          // Deduplicate — REST response may have already added this session
          if (prev.some((s) => s.id === payload.session.id)) return prev;
          return [...prev, payload.session];
        });
      }
    );

    const unsubState = subscribe<{ sessionId: string; state: CodingAgentSessionState }>(
      'coding-agent:session:state',
      (payload) => {
        setSessions((prev) =>
          prev.map((s) => (s.id === payload.sessionId ? { ...s, state: payload.state } : s))
        );
      }
    );

    return () => {
      unsubCreated();
      unsubState();
    };
  }, [subscribe]);

  // Create session
  const handleCreateSession = useCallback(
    async (provider: string, prompt: string, mode: 'auto' | 'interactive', cwd?: string) => {
      try {
        const session = await codingAgentsApi.createSession({
          provider,
          prompt,
          mode,
          cwd: cwd || undefined,
        });
        setSessions((prev) => {
          if (prev.some((s) => s.id === session.id)) return prev;
          return [...prev, session];
        });
        setActiveSessionId(session.id);
        setShowNewSession(false);
        toast.success(`Session started with ${provider}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create session');
      }
    },
    [toast]
  );

  // Terminate session
  const handleTerminate = useCallback(
    async (sessionId: string) => {
      try {
        await codingAgentsApi.terminateSession(sessionId);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId ? { ...s, state: 'terminated' as CodingAgentSessionState } : s
          )
        );
        toast.success('Session terminated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to terminate');
      }
    },
    [toast]
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeSessions = sessions.filter(
    (s) => s.state === 'starting' || s.state === 'running' || s.state === 'waiting'
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <header className="flex items-center justify-between px-6 pt-4 pb-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Coding Agents
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Run AI coding agents autonomously — {activeSessions.length} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAll}
            disabled={isLoading}
            className="p-2 rounded-lg text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowNewSession(true)}
            disabled={activeSessions.length >= 3}
            className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
            title={activeSessions.length >= 3 ? 'Maximum 3 concurrent sessions' : 'New session'}
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        </div>
      </header>

      {/* Content: split panel */}
      <div className="flex-1 flex min-h-0">
        {/* Left sidebar: session list */}
        <div className="w-64 flex-shrink-0 border-r border-border dark:border-dark-border overflow-y-auto flex flex-col">
          {/* Sessions */}
          <div className="flex-1 p-3 space-y-1.5">
            {sessions.length === 0 && !isLoading && (
              <div className="text-center py-8 text-text-muted dark:text-dark-text-muted text-sm">
                <Terminal className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No sessions yet</p>
                <p className="text-xs mt-1">Click "New Session" to start</p>
              </div>
            )}

            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                onClick={() => setActiveSessionId(session.id)}
                onTerminate={() => handleTerminate(session.id)}
              />
            ))}
          </div>

          {/* History (collapsible) */}
          <div className="border-t border-border dark:border-dark-border">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            >
              <span>History ({results.length})</span>
              {showHistory ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>

            {showHistory && (
              <div className="px-3 pb-3 space-y-1.5 max-h-48 overflow-y-auto">
                {results.length === 0 ? (
                  <p className="text-[10px] text-text-muted dark:text-dark-text-muted py-2 text-center">
                    No results yet
                  </p>
                ) : (
                  results.map((r) => <ResultCard key={r.id} result={r} />)
                )}
              </div>
            )}
          </div>

          {/* Provider status (collapsible) */}
          <div className="border-t border-border dark:border-dark-border">
            <button
              onClick={() => setShowProviders(!showProviders)}
              className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            >
              <span>Provider Status</span>
              {showProviders ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>

            {showProviders && (
              <div className="px-3 pb-3 space-y-2">
                {statuses.map((status) => (
                  <ProviderStatusCard key={status.provider} status={status} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel: terminal or auto mode panel */}
        <div className="flex-1 min-w-0 flex flex-col">
          {activeSession ? (
            activeSession.mode === 'auto' ? (
              /* Auto mode: structured output panel */
              <AutoModePanel
                key={activeSession.id}
                sessionId={activeSession.id}
                session={activeSession}
                onTerminate={() => handleTerminate(activeSession.id)}
              />
            ) : (
              /* Interactive mode: session info bar + xterm.js terminal */
              <>
                <div className="px-4 py-2 bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border flex items-center gap-3 text-sm">
                  <div
                    className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${PROVIDER_COLORS[activeSession.provider] ?? 'bg-gray-500/20'}`}
                  >
                    {PROVIDER_META[activeSession.provider]?.icon ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-text-primary dark:text-dark-text-primary truncate block">
                      {activeSession.displayName}
                    </span>
                  </div>
                  <StateBadge state={activeSession.state} />
                  {(activeSession.state === 'running' || activeSession.state === 'starting') && (
                    <button
                      onClick={() => handleTerminate(activeSession.id)}
                      className="p-1 rounded text-text-muted hover:text-error transition-colors"
                      title="Terminate"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex-1 min-h-0 relative">
                  <div className="absolute inset-0">
                    <XTerminal sessionId={activeSession.id} interactive={true} />
                  </div>
                </div>
              </>
            )
          ) : (
            /* Empty state */
            <div className="flex-1 flex items-center justify-center text-text-muted dark:text-dark-text-muted">
              <div className="text-center">
                <Terminal className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p className="text-lg font-medium mb-2">No session selected</p>
                <p className="text-sm mb-4">
                  {sessions.length > 0
                    ? 'Select a session from the sidebar'
                    : 'Create a new session to get started'}
                </p>
                {sessions.length === 0 && (
                  <button
                    onClick={() => setShowNewSession(true)}
                    className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Create Session
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Session Modal */}
      {showNewSession && (
        <NewSessionModal
          statuses={statuses}
          onClose={() => setShowNewSession(false)}
          onCreate={handleCreateSession}
        />
      )}
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function SessionCard({
  session,
  active,
  onClick,
  onTerminate,
}: {
  session: CodingAgentSession;
  active: boolean;
  onClick: () => void;
  onTerminate: () => void;
}) {
  const color = PROVIDER_COLORS[session.provider] ?? 'bg-gray-500/20 text-gray-500';
  const icon = PROVIDER_META[session.provider]?.icon ?? '?';
  const isActive =
    session.state === 'running' || session.state === 'starting' || session.state === 'waiting';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      className={`w-full text-left p-2.5 rounded-lg transition-colors group cursor-pointer ${
        active
          ? 'bg-primary/10 border border-primary/30'
          : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${color}`}
        >
          {icon}
        </div>
        <StateBadge state={session.state} />
        {isActive && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTerminate();
            }}
            className="ml-auto p-0.5 rounded opacity-0 group-hover:opacity-100 text-text-muted hover:text-error transition-all"
            title="Terminate"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className="text-xs text-text-primary dark:text-dark-text-primary truncate">
        {session.prompt.length > 60 ? session.prompt.slice(0, 60) + '...' : session.prompt}
      </p>
      <div className="flex items-center gap-1 mt-1 text-[10px] text-text-muted dark:text-dark-text-muted">
        <Clock className="w-2.5 h-2.5" />
        <span>{formatRelativeTime(session.startedAt)}</span>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: CodingAgentSessionState }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-text-muted dark:text-dark-text-muted">
      <span
        className={`w-1.5 h-1.5 rounded-full ${STATE_COLORS[state]} ${state === 'running' ? 'animate-pulse' : ''}`}
      />
      {STATE_LABELS[state]}
    </span>
  );
}

function ProviderStatusCard({ status }: { status: CodingAgentStatus }) {
  const meta = PROVIDER_META[status.provider];
  const color = PROVIDER_COLORS[status.provider] ?? 'bg-gray-500/20';

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
      <div
        className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${color}`}
      >
        {meta?.icon ?? '?'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary truncate">
          {status.displayName}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {status.installed ? (
            <CheckCircle2 className="w-2.5 h-2.5 text-success" />
          ) : (
            <XCircle className="w-2.5 h-2.5 text-error" />
          )}
          <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
            {status.installed ? (status.version ?? 'Installed') : 'Not installed'}
          </span>
          {status.configured && <Key className="w-2.5 h-2.5 text-success ml-1" />}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// New Session Modal
// =============================================================================

function NewSessionModal({
  statuses,
  onClose,
  onCreate,
}: {
  statuses: CodingAgentStatus[];
  onClose: () => void;
  onCreate: (provider: string, prompt: string, mode: 'auto' | 'interactive', cwd?: string) => void;
}) {
  const installedProviders = statuses.filter((s) => s.installed);
  const ptyAvailable = statuses.some((s) => s.ptyAvailable);

  const [provider, setProvider] = useState(() => installedProviders[0]?.provider ?? '');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'auto' | 'interactive'>('auto');
  const [cwd, setCwd] = useState('');
  const [creating, setCreating] = useState(false);
  const [workspaces, setWorkspaces] = useState<FileWorkspaceInfo[]>([]);
  const [cwdMode, setCwdMode] = useState<'workspace' | 'custom'>('workspace');

  // Fetch file workspaces for the picker
  useEffect(() => {
    fileWorkspacesApi
      .list()
      .then((data) => setWorkspaces(data.workspaces ?? []))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider || !prompt.trim()) return;
    setCreating(true);
    try {
      await onCreate(provider, prompt.trim(), mode, cwd.trim() || undefined);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4">
            New Coding Agent Session
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Provider selection */}
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Provider
              </label>
              <div className="grid grid-cols-3 gap-2">
                {statuses.map((s) => {
                  const meta = PROVIDER_META[s.provider];
                  const isCustom = s.provider.startsWith('custom:');
                  const color =
                    PROVIDER_COLORS[s.provider] ??
                    'bg-purple-500/20 text-purple-600 dark:text-purple-400';
                  const icon =
                    meta?.icon ?? (isCustom ? s.displayName.charAt(0).toUpperCase() : '?');
                  const selected = provider === s.provider;

                  return (
                    <button
                      key={s.provider}
                      type="button"
                      disabled={!s.installed}
                      onClick={() => setProvider(s.provider)}
                      className={`p-3 rounded-lg border text-center transition-colors ${
                        selected
                          ? 'border-primary bg-primary/10'
                          : s.installed
                            ? 'border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                            : 'border-border dark:border-dark-border opacity-40 cursor-not-allowed'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg mx-auto mb-1 flex items-center justify-center text-sm font-bold ${color}`}
                      >
                        {icon}
                      </div>
                      <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                        {s.displayName}
                      </div>
                      {isCustom && (
                        <div className="text-[10px] text-text-muted dark:text-dark-text-muted mt-0.5">
                          Custom
                        </div>
                      )}
                      {!s.installed && (
                        <div className="text-[10px] text-error mt-0.5">Not installed</div>
                      )}
                    </button>
                  );
                })}
              </div>
              {installedProviders.length === 0 && (
                <p className="text-xs text-error mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  No providers installed. Install at least one CLI tool.
                </p>
              )}
            </div>

            {/* Working directory — workspace picker or custom path */}
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                Working Directory
              </label>
              <div className="flex gap-1.5 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setCwdMode('workspace');
                    setCwd('');
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    cwdMode === 'workspace'
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                >
                  Workspace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCwdMode('custom');
                    setCwd('');
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    cwdMode === 'custom'
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                >
                  Custom Path
                </button>
              </div>

              {cwdMode === 'workspace' ? (
                <div className="space-y-1.5">
                  {workspaces.length === 0 ? (
                    <p className="text-xs text-text-muted dark:text-dark-text-muted py-2">
                      No workspaces found. Use "Custom Path" or create a workspace first.
                    </p>
                  ) : (
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-border dark:border-dark-border">
                      {workspaces.map((ws) => (
                        <button
                          key={ws.id}
                          type="button"
                          onClick={() => setCwd(ws.path)}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors border-b border-border/50 dark:border-dark-border/50 last:border-b-0 ${
                            cwd === ws.path
                              ? 'bg-primary/10 text-primary'
                              : 'text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                          }`}
                        >
                          <div className="font-medium truncate">{ws.name}</div>
                          <div className="text-[10px] text-text-muted dark:text-dark-text-muted truncate">
                            {ws.path}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {cwd && (
                    <div className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                      Selected: <span className="font-mono">{cwd}</span>
                    </div>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="C:\Projects\my-app or /home/user/projects/my-app"
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm placeholder-text-muted dark:placeholder-dark-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
              )}
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                Task
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what the agent should do..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm placeholder-text-muted dark:placeholder-dark-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Mode toggle */}
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                Mode
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('auto')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    mode === 'auto'
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 inline mr-1.5" />
                  Auto
                  <span className="block text-[10px] mt-0.5 opacity-70">
                    Fully autonomous — agent runs and completes the task
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => ptyAvailable && setMode('interactive')}
                  disabled={!ptyAvailable}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    !ptyAvailable
                      ? 'border-border dark:border-dark-border opacity-40 cursor-not-allowed text-text-muted dark:text-dark-text-muted'
                      : mode === 'interactive'
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                  title={!ptyAvailable ? 'Requires node-pty: pnpm add node-pty' : undefined}
                >
                  <Terminal className="w-3.5 h-3.5 inline mr-1.5" />
                  Interactive
                  <span className="block text-[10px] mt-0.5 opacity-70">
                    {ptyAvailable
                      ? 'Full terminal — approve, deny, type commands'
                      : 'Requires node-pty (not installed)'}
                  </span>
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!provider || !prompt.trim() || creating}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {creating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Start Session
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: CodingAgentResultRecord }) {
  const providerLabel = result.provider.startsWith('custom:')
    ? result.provider.slice(7)
    : result.provider;

  return (
    <div className="p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
      <div className="flex items-center gap-1.5 mb-0.5">
        {result.success ? (
          <CheckCircle2 className="w-2.5 h-2.5 text-success shrink-0" />
        ) : (
          <XCircle className="w-2.5 h-2.5 text-error shrink-0" />
        )}
        <span className="text-[10px] font-medium text-text-primary dark:text-dark-text-primary truncate">
          {providerLabel}
        </span>
        <span className="text-[10px] text-text-muted dark:text-dark-text-muted ml-auto shrink-0">
          {formatDuration(result.durationMs)}
        </span>
      </div>
      <p className="text-[10px] text-text-muted dark:text-dark-text-muted truncate">
        {result.prompt.length > 50 ? result.prompt.slice(0, 50) + '...' : result.prompt}
      </p>
      <div className="text-[9px] text-text-muted dark:text-dark-text-muted mt-0.5">
        {formatRelativeTime(result.createdAt)}
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
