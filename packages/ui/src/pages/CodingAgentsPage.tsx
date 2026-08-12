/**
 * Coding Agents Page
 *
 * Interactive terminal sessions for external AI coding agents
 * (Claude Code, Codex, Gemini CLI). Split panel layout:
 * left sidebar for session list + provider status,
 * right panel for live xterm.js terminal.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useToast } from '../components/ToastProvider';
import { PageHomeTab } from '../components/PageHomeTab';
import { useSkipHome } from '../hooks/useSkipHome';
import {
  RefreshCw,
  Terminal,
  Plus,
  StopCircle,
  ChevronDown,
  ChevronRight,
  Home,
  Code,
  Bot,
  Layers,
  History,
} from '../components/icons';
import { XTerminal } from '../components/XTerminal';
import { AutoModePanel } from '../components/AutoModePanel';
import { AcpPanel } from '../components/AcpPanel';
import { PipelinesTab } from './coding-agents/PipelinesTab';
import { NewSessionModal } from './coding-agents/NewSessionModal';
import { SessionCard, StateBadge, ProviderStatusCard, ResultCard } from './coding-agents/cards';
import { codingAgentsApi } from '../api';
import type {
  CodingAgentStatus,
  CodingAgentSession,
  CodingAgentSessionState,
  CodingAgentResultRecord,
  CodingAgentPermissions,
} from '../api/endpoints/coding-agents';
import { useGateway } from '../hooks/useWebSocket';

import {
  PROVIDER_META,
  PROVIDER_COLORS,
  TAB_LABELS,
  type TabId,
} from './CodingAgentsPage.constants';

// =============================================================================
// Main Component
// =============================================================================

export function CodingAgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(tabParam || 'home');

  const { skipHome, onSkipHomeChange } = useSkipHome({
    pageName: 'codingagents',
    defaultTab: 'agents',
  });

  useEffect(() => {
    const urlTab = (searchParams.get('tab') as TabId | null) || 'home';
    setActiveTab(urlTab);
  }, [searchParams]);

  const setTab = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      setSearchParams(tab === 'home' ? {} : { tab });
    },
    [setSearchParams]
  );

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
  const [viewMode, setViewMode] = useState<'structured' | 'terminal' | 'acp'>('terminal');

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
    async (
      provider: string,
      prompt: string,
      mode: 'auto' | 'interactive',
      cwd?: string,
      skillIds?: string[],
      permissions?: CodingAgentPermissions,
      settingsFile?: string
    ) => {
      try {
        const session = await codingAgentsApi.createSession({
          provider,
          prompt,
          mode,
          cwd: cwd || undefined,
          skill_ids: skillIds?.length ? skillIds : undefined,
          permissions: permissions || undefined,
          settings_file: settingsFile || undefined,
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

  // Auto-switch to ACP view when selecting an ACP-enabled session
  useEffect(() => {
    if (activeSession?.acp?.enabled && viewMode !== 'acp') {
      setViewMode('acp');
    }
  }, [activeSession?.acp?.enabled, viewMode]);

  const activeSessions = sessions.filter(
    (s) => s.state === 'starting' || s.state === 'running' || s.state === 'waiting'
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
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
            onClick={() => {
              setTab('agents');
              setShowNewSession(true);
            }}
            disabled={activeSessions.length >= 3}
            className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
            title={activeSessions.length >= 3 ? 'Maximum 3 concurrent sessions' : 'New session'}
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'agents', 'pipelines'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Home tab */}
      {activeTab === 'home' && (
        <PageHomeTab
          heroIcons={[
            { icon: Terminal, color: 'text-primary bg-primary/10' },
            { icon: Code, color: 'text-emerald-500 bg-emerald-500/10' },
            { icon: Bot, color: 'text-violet-500 bg-violet-500/10' },
          ]}
          title="AI-Powered Coding Assistants"
          subtitle="Spin up coding agents that can read, write, and execute code — powered by Claude, Gemini, or Codex with full terminal access."
          cta={{ label: 'View Sessions', icon: Terminal, onClick: () => setTab('agents') }}
          skipHomeChecked={skipHome}
          onSkipHomeChange={onSkipHomeChange}
          skipHomeLabel="Skip this screen and go directly to Agents"
          features={[
            {
              icon: Layers,
              color: 'text-blue-500 bg-blue-500/10',
              title: 'Multi-Provider',
              description: 'Claude, Gemini, Codex — choose the best coding agent for each task.',
            },
            {
              icon: Terminal,
              color: 'text-emerald-500 bg-emerald-500/10',
              title: 'Terminal Access',
              description: 'Full interactive terminal sessions with live output streaming.',
            },
            {
              icon: Code,
              color: 'text-orange-500 bg-orange-500/10',
              title: 'Code Execution',
              description: 'Agents can read, write, and run code directly in your workspace.',
            },
            {
              icon: History,
              color: 'text-purple-500 bg-purple-500/10',
              title: 'Session Management',
              description: 'Track active sessions, view history, and manage concurrent agents.',
            },
          ]}
          steps={[
            {
              title: 'Configure a coding provider',
              detail: 'Set up Claude Code, Gemini CLI, or Codex.',
            },
            {
              title: 'Start a coding session',
              detail: 'Launch a new terminal session with your chosen provider.',
            },
            {
              title: 'Give instructions in natural language',
              detail: 'Describe what you want the agent to build or fix.',
            },
            { title: 'Review generated code', detail: 'Inspect the output and iterate as needed.' },
          ]}
          quickActions={[
            {
              label: 'Manage Sessions',
              icon: Terminal,
              description: 'View active sessions and start new coding agents.',
              onClick: () => setTab('agents'),
            },
          ]}
        />
      )}

      {/* Agents tab — Content: split panel */}
      {activeTab === 'agents' && (
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

          {/* Right panel: session view with toggle */}
          <div className="flex-1 min-w-0 flex flex-col">
            {activeSession ? (
              <>
                {/* Session header bar */}
                <div className="px-4 py-2 bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border flex items-center gap-3 text-sm shrink-0">
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

                  {/* View toggle */}
                  {activeSession.mode === 'auto' && (
                    <div className="flex items-center bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md p-0.5">
                      <button
                        onClick={() => setViewMode('terminal')}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          viewMode === 'terminal'
                            ? 'bg-primary/20 text-primary'
                            : 'text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
                        }`}
                      >
                        Terminal
                      </button>
                      <button
                        onClick={() => setViewMode('structured')}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          viewMode === 'structured'
                            ? 'bg-primary/20 text-primary'
                            : 'text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
                        }`}
                      >
                        Structured
                      </button>
                      {activeSession.acp?.enabled && (
                        <button
                          onClick={() => setViewMode('acp')}
                          className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                            viewMode === 'acp'
                              ? 'bg-violet-500/20 text-violet-400'
                              : 'text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
                          }`}
                        >
                          ACP
                        </button>
                      )}
                    </div>
                  )}

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

                {/* Content: terminal, structured, or ACP view */}
                {activeSession.mode === 'auto' && viewMode === 'acp' ? (
                  <AcpPanel
                    key={`acp-${activeSession.id}`}
                    sessionId={activeSession.id}
                    session={activeSession}
                    onTerminate={() => handleTerminate(activeSession.id)}
                  />
                ) : activeSession.mode === 'auto' && viewMode === 'structured' ? (
                  <AutoModePanel
                    key={activeSession.id}
                    sessionId={activeSession.id}
                    session={activeSession}
                    onTerminate={() => handleTerminate(activeSession.id)}
                  />
                ) : (
                  <div className="flex-1 min-h-0 relative">
                    <div className="absolute inset-0">
                      <XTerminal sessionId={activeSession.id} interactive={true} />
                    </div>
                  </div>
                )}
              </>
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
      )}

      {/* Pipelines tab */}
      {activeTab === 'pipelines' && <PipelinesTab />}

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
