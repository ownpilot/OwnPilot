/**
 * Claws Page — Unified Autonomous Agent Runtime Monitor
 *
 * Follows the app's page convention: header -> tab bar -> PageHomeTab / content.
 */

import { useState, useEffect, useCallback } from 'react';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import { useDialog } from '../components/ConfirmDialog';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { clawsApi } from '../api/endpoints/claws';
import type { ClawConfig, ClawHistoryEntry, ClawState } from '../api/endpoints/claws';
import {
  Plus,
  Play,
  Pause,
  Square,
  Trash2,
  RefreshCw,
  Activity,
  CheckCircle2,
  XCircle,
  Send,
  X,
  Home,
  Zap,
  Brain,
  Bot,
  Terminal,
  ChevronDown,
  ChevronRight,
  Settings,
  Clock,
  Puzzle,
  Save,
  FolderOpen,
  FileText,
  Download,
  ArrowLeft,
  Copy,
} from '../components/icons';

// =============================================================================
// Helpers
// =============================================================================

/** Fetch with session token auth */
function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  try {
    const token = localStorage.getItem('ownpilot-session-token');
    if (token) headers['X-Session-Token'] = token;
  } catch { /* ignore */ }
  return fetch(url, { ...init, headers });
}

function getStateBadge(state: ClawState | null): { text: string; classes: string } {
  switch (state) {
    case 'running':
      return { text: 'Running', classes: 'bg-green-500/15 text-green-600 dark:text-green-400' };
    case 'paused':
      return { text: 'Paused', classes: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
    case 'starting':
      return { text: 'Starting', classes: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' };
    case 'waiting':
      return { text: 'Waiting', classes: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400' };
    case 'completed':
      return { text: 'Completed', classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' };
    case 'failed':
      return { text: 'Failed', classes: 'bg-red-500/15 text-red-600 dark:text-red-400' };
    case 'stopped':
      return { text: 'Stopped', classes: 'bg-gray-500/15 text-gray-600 dark:text-gray-400' };
    case 'escalation_pending':
      return { text: 'Escalation', classes: 'bg-purple-500/15 text-purple-600 dark:text-purple-400' };
    default:
      return { text: 'Idle', classes: 'bg-gray-500/15 text-gray-500' };
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// =============================================================================
// Page
// =============================================================================

type PageTab = 'home' | 'claws';

export function ClawsPage() {
  const [pageTab, setPageTab] = useState<PageTab>('claws');
  const [claws, setClaws] = useState<ClawConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedClaw, setSelectedClaw] = useState<ClawConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { subscribe } = useGateway();
  const toast = useToast();
  const { confirm } = useDialog();

  const fetchClaws = useCallback(async () => {
    try {
      const data = await clawsApi.list();
      setClaws(data);
    } catch {
      toast.error('Failed to load claws');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchClaws();
  }, [fetchClaws]);

  // WS-driven refresh
  useEffect(() => {
    const unsubs = [
      subscribe<{ entity: string }>('data:changed', (p) => {
        if (p.entity === 'claw') fetchClaws();
      }),
      subscribe<{ clawId: string }>('claw.update', () => fetchClaws()),
      subscribe<{ clawId: string }>('claw.started', () => fetchClaws()),
      subscribe<{ clawId: string }>('claw.stopped', () => fetchClaws()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, fetchClaws]);

  // Actions
  const startClaw = async (id: string) => {
    try {
      await clawsApi.start(id);
      toast.success('Claw started');
      fetchClaws();
    } catch {
      toast.error('Failed to start claw');
    }
  };

  const pauseClaw = async (id: string) => {
    try {
      await clawsApi.pause(id);
      toast.success('Claw paused');
      fetchClaws();
    } catch {
      toast.error('Failed to pause claw');
    }
  };

  const resumeClaw = async (id: string) => {
    try {
      await clawsApi.resume(id);
      toast.success('Claw resumed');
      fetchClaws();
    } catch {
      toast.error('Failed to resume claw');
    }
  };

  const stopClaw = async (id: string) => {
    try {
      await clawsApi.stop(id);
      toast.success('Claw stopped');
      fetchClaws();
    } catch {
      toast.error('Failed to stop claw');
    }
  };

  const deleteClaw = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete Claw',
      message: `Delete "${name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await clawsApi.delete(id);
      toast.success('Claw deleted');
      if (selectedClaw?.id === id) setSelectedClaw(null);
      fetchClaws();
    } catch {
      toast.error('Failed to delete claw');
    }
  };

  const approveEscalation = async (id: string) => {
    try {
      await clawsApi.approveEscalation(id);
      toast.success('Escalation approved');
      fetchClaws();
    } catch {
      toast.error('Failed to approve escalation');
    }
  };

  const cloneClaw = async (source: ClawConfig) => {
    try {
      await clawsApi.create({
        name: `${source.name} (copy)`,
        mission: source.mission,
        mode: source.mode,
        sandbox: source.sandbox,
        provider: source.provider,
        model: source.model,
        coding_agent_provider: source.codingAgentProvider,
        skills: source.skills,
        allowed_tools: source.allowedTools.length > 0 ? source.allowedTools : undefined,
        interval_ms: source.intervalMs,
        event_filters: source.eventFilters,
        stop_condition: source.stopCondition,
      });
      toast.success(`Cloned "${source.name}"`);
      fetchClaws();
    } catch {
      toast.error('Failed to clone claw');
    }
  };

  // Bulk actions
  const bulkStop = async () => {
    for (const id of selectedIds) { try { await clawsApi.stop(id); } catch { /* skip */ } }
    toast.success(`Stopped ${selectedIds.size} claws`);
    setSelectedIds(new Set());
    fetchClaws();
  };

  const bulkDelete = async () => {
    const ok = await confirm({ title: 'Delete Selected', message: `Delete ${selectedIds.size} claws?`, confirmText: 'Delete All', variant: 'danger' });
    if (!ok) return;
    for (const id of selectedIds) { try { await clawsApi.delete(id); } catch { /* skip */ } }
    toast.success(`Deleted ${selectedIds.size} claws`);
    setSelectedIds(new Set());
    setSelectedClaw(null);
    fetchClaws();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // Filtering
  const filteredClaws = claws.filter((c) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!c.name.toLowerCase().includes(q) && !c.mission.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q)) return false;
    }
    if (filterMode && c.mode !== filterMode) return false;
    if (filterState) {
      const state = c.session?.state ?? 'stopped';
      if (filterState === 'active' && !['running', 'starting', 'waiting'].includes(state)) return false;
      if (filterState === 'stopped' && !['stopped', 'completed', 'failed'].includes(state)) return false;
      if (filterState === 'paused' && state !== 'paused') return false;
    }
    return true;
  });

  const runningCount = claws.filter((c) =>
    c.session && ['running', 'starting', 'waiting'].includes(c.session.state)
  ).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Claws
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {claws.length} claw{claws.length !== 1 ? 's' : ''}
            {runningCount > 0 && ` \u00B7 ${runningCount} running`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setIsLoading(true); fetchClaws(); }}
            className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Claw
          </button>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'claws'] as PageTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setPageTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              pageTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {tab === 'claws' && <Activity className="w-3.5 h-3.5" />}
            {tab === 'home' ? 'Home' : 'Claws'}
          </button>
        ))}
      </div>

      {/* Home Tab */}
      {pageTab === 'home' && (
        <ClawHomeTab
          claws={claws}
          onCreateClaw={() => setShowCreate(true)}
          onViewClaws={() => setPageTab('claws')}
        />
      )}

      {/* Claws Tab */}
      {pageTab === 'claws' && (
        <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
          {isLoading ? (
            <LoadingSpinner message="Loading claws..." />
          ) : claws.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="No claws yet"
              description="Create your first Claw agent to start autonomous task execution."
              action={{ label: 'Create Claw', onClick: () => setShowCreate(true) }}
            />
          ) : (
            <div className="space-y-4">
              {/* Search + Filter Bar */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, mission, or ID..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted"
                  />
                </div>
                <select value={filterMode} onChange={(e) => setFilterMode(e.target.value)}
                  className="px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary">
                  <option value="">All modes</option>
                  <option value="single-shot">Single-shot</option>
                  <option value="continuous">Continuous</option>
                  <option value="interval">Interval</option>
                  <option value="event">Event</option>
                </select>
                <select value={filterState} onChange={(e) => setFilterState(e.target.value)}
                  className="px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary">
                  <option value="">All states</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="stopped">Stopped</option>
                </select>
                <span className="text-xs text-text-muted dark:text-dark-text-muted">
                  {filteredClaws.length} of {claws.length}
                </span>
              </div>

              {/* Bulk Actions (when items selected) */}
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-primary/5 border border-primary/20">
                  <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
                  <div className="flex-1" />
                  <button onClick={bulkStop} className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-amber-500/10 text-amber-600 hover:bg-amber-500/20">
                    <Square className="w-3 h-3" /> Stop All
                  </button>
                  <button onClick={bulkDelete} className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-red-500/10 text-red-600 hover:bg-red-500/20">
                    <Trash2 className="w-3 h-3" /> Delete All
                  </button>
                  <button onClick={() => setSelectedIds(new Set())} className="text-xs text-text-muted hover:text-text-primary">Clear</button>
                </div>
              )}

              {/* Claw Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredClaws.map((claw) => (
                  <ClawCard
                    key={claw.id}
                    claw={claw}
                    onStart={() => startClaw(claw.id)}
                    onPause={() => pauseClaw(claw.id)}
                    onResume={() => resumeClaw(claw.id)}
                    onStop={() => stopClaw(claw.id)}
                    onDelete={() => deleteClaw(claw.id, claw.name)}
                    onClone={() => cloneClaw(claw)}
                    onApproveEscalation={() => approveEscalation(claw.id)}
                    onSelect={() => setSelectedClaw(claw)}
                    isSelected={selectedClaw?.id === claw.id}
                    isChecked={selectedIds.has(claw.id)}
                    onToggleCheck={() => toggleSelect(claw.id)}
                  />
                ))}
              </div>

              {/* Detail Panel — inline below cards */}
              {selectedClaw && (
                <ClawManagementPanel
                  claw={selectedClaw}
                  onClose={() => setSelectedClaw(null)}
                  onUpdate={fetchClaws}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateClawModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchClaws();
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// ClawHomeTab — Rich landing page
// =============================================================================

function ClawHomeTab({
  claws,
  onCreateClaw,
  onViewClaws,
}: {
  claws: ClawConfig[];
  onCreateClaw: () => void;
  onViewClaws: () => void;
}) {
  const totalCycles = claws.reduce((s, c) => s + (c.session?.cyclesCompleted ?? 0), 0);
  const totalToolCalls = claws.reduce((s, c) => s + (c.session?.totalToolCalls ?? 0), 0);
  const totalCost = claws.reduce((s, c) => s + (c.session?.totalCostUsd ?? 0), 0);
  const runningCount = claws.filter((c) => c.session?.state === 'running' || c.session?.state === 'starting').length;

  const CAPABILITIES = [
    { icon: Brain, color: 'text-blue-500 bg-blue-500/10', title: 'LLM Brain', items: ['Full LLM reasoning per cycle', 'Memory injection from past cycles', 'Soul identity for personality', 'Provider/model per claw'] },
    { icon: Terminal, color: 'text-emerald-500 bg-emerald-500/10', title: 'Code Execution', items: ['Python, JavaScript, Shell scripts', 'Docker sandbox (256MB, isolated)', 'Local fallback execution', 'Install npm/pip packages on the fly'] },
    { icon: Bot, color: 'text-purple-500 bg-purple-500/10', title: 'CLI & Coding Agents', items: ['Install & run ANY CLI tool', 'Claude Code / Codex / Gemini CLI', 'Multi-step orchestrated coding', 'git, docker, curl, ffmpeg...'] },
    { icon: Activity, color: 'text-cyan-500 bg-cyan-500/10', title: 'Browser Automation', items: ['Headless Chromium navigation', 'Click, type, fill forms', 'Screenshot capture', 'Structured data extraction'] },
    { icon: Zap, color: 'text-amber-500 bg-amber-500/10', title: 'Self-Provisioning', items: ['Create ephemeral tools at runtime', 'Spawn sub-claws (3 levels deep)', 'Publish artifacts (HTML/SVG/MD)', 'Request escalation when needed'] },
    { icon: Send, color: 'text-pink-500 bg-pink-500/10', title: 'Output Delivery', items: ['Telegram notifications', 'Real-time WebSocket feed', 'Conversation history storage', 'Final report with artifact'] },
  ];

  const MODES = [
    { name: 'Single-shot', desc: 'One execution, one result. Perfect for tasks with clear deliverables.', color: 'bg-blue-500' },
    { name: 'Continuous', desc: 'Adaptive loop — speeds up when active, slows when idle. For ongoing work.', color: 'bg-emerald-500' },
    { name: 'Interval', desc: 'Fixed interval between cycles (e.g., every 5 minutes). For periodic checks.', color: 'bg-amber-500' },
    { name: 'Event-driven', desc: 'Waits for system events, then executes. For reactive automation.', color: 'bg-purple-500' },
  ];

  return (
    <div className="flex-1 overflow-y-auto animate-fade-in-up">
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-purple-500/5 to-emerald-500/5 px-8 py-10">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Zap className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">Claw Agents</h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">Autonomous agents with unlimited capabilities</p>
            </div>
          </div>
          <p className="text-text-secondary dark:text-dark-text-secondary mt-3 max-w-2xl leading-relaxed">
            Each Claw is a fully autonomous agent with its own workspace, 250+ tools, CLI access, browser automation,
            coding agents, and script execution. Give it a mission and let it work.
          </p>
          <div className="flex gap-3 mt-6">
            <button onClick={onCreateClaw} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors shadow-sm">
              <Plus className="w-4 h-4" /> Create Claw
            </button>
            {claws.length > 0 && (
              <button onClick={onViewClaws} className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary font-medium hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors">
                <Activity className="w-4 h-4" /> View Claws ({claws.length})
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-6 space-y-8">

        {/* Live Stats */}
        {claws.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Active Claws', value: runningCount, sub: `of ${claws.length} total`, color: 'text-green-500' },
              { label: 'Total Cycles', value: totalCycles.toLocaleString(), sub: 'executions', color: 'text-blue-500' },
              { label: 'Tool Calls', value: totalToolCalls.toLocaleString(), sub: 'across all claws', color: 'text-purple-500' },
              { label: 'Total Cost', value: `$${totalCost.toFixed(2)}`, sub: 'USD spent', color: 'text-amber-500' },
            ].map((stat) => (
              <div key={stat.label} className="bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl p-4">
                <p className="text-xs text-text-muted dark:text-dark-text-muted uppercase tracking-wider">{stat.label}</p>
                <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">{stat.sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Capabilities Grid */}
        <div>
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4">What Can a Claw Do?</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAPABILITIES.map((cap) => (
              <div key={cap.title} className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className={`w-8 h-8 rounded-lg ${cap.color} flex items-center justify-center`}>
                    <cap.icon className="w-4 h-4" />
                  </div>
                  <h4 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">{cap.title}</h4>
                </div>
                <ul className="space-y-1">
                  {cap.items.map((item) => (
                    <li key={item} className="text-xs text-text-secondary dark:text-dark-text-secondary flex items-start gap-1.5">
                      <span className="text-primary mt-0.5 shrink-0">-</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Execution Modes */}
        <div>
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4">Execution Modes</h3>
          <div className="grid md:grid-cols-2 gap-3">
            {MODES.map((mode) => (
              <div key={mode.name} className="flex items-start gap-3 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl p-4 border border-border dark:border-dark-border">
                <div className={`w-2 h-2 rounded-full ${mode.color} mt-1.5 shrink-0`} />
                <div>
                  <h4 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">{mode.name}</h4>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">{mode.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How It Works */}
        <div>
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4">How It Works</h3>
          <div className="relative">
            {[
              { step: '1', title: 'Define Mission & Configure', desc: 'Set a mission, pick a mode (single-shot, continuous, interval, event), assign skills, choose provider/model, and set limits.' },
              { step: '2', title: 'Claw Gets Its Environment', desc: 'An isolated workspace is created. All 250+ tools are registered. Skills are filtered. The claw gets a unique conversation context.' },
              { step: '3', title: 'Autonomous Execution', desc: 'The claw runs cycles autonomously — using tools, installing packages, browsing the web, running scripts, creating sub-claws. No hand-holding needed.' },
              { step: '4', title: 'Live Output & Final Report', desc: 'Progress is sent to you via Telegram and the live output feed. When done, a comprehensive report is published as an artifact.' },
            ].map((item, i) => (
              <div key={item.step} className="flex gap-4 mb-4 last:mb-0">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">{item.step}</div>
                  {i < 3 && <div className="w-px flex-1 bg-border dark:bg-dark-border mt-1" />}
                </div>
                <div className="pb-4">
                  <h4 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">{item.title}</h4>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// =============================================================================
// ClawCard
// =============================================================================

function ClawCard({
  claw,
  onStart,
  onPause,
  onResume,
  onStop,
  onDelete,
  onClone,
  onApproveEscalation,
  onSelect,
  isSelected,
  isChecked,
  onToggleCheck,
}: {
  claw: ClawConfig;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDelete: () => void;
  onClone: () => void;
  onApproveEscalation: () => void;
  isChecked?: boolean;
  onToggleCheck?: () => void;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const state = claw.session?.state ?? null;
  const badge = getStateBadge(state);
  const isRunning = state === 'running' || state === 'starting' || state === 'waiting';
  const isPaused = state === 'paused';
  const isEscalation = state === 'escalation_pending';

  return (
    <div
      onClick={onSelect}
      className={`bg-bg-primary dark:bg-dark-bg-primary border rounded-xl p-4 hover:shadow-sm transition-all cursor-pointer ${
        isSelected
          ? 'border-primary ring-1 ring-primary/30'
          : 'border-border dark:border-dark-border'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        {onToggleCheck && (
          <input
            type="checkbox"
            checked={isChecked ?? false}
            onChange={(e) => { e.stopPropagation(); onToggleCheck(); }}
            className="w-3.5 h-3.5 rounded accent-primary mt-1 mr-2 shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary truncate">
            {claw.name}
          </h3>
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
            {claw.mode} {claw.depth > 0 && `\u00B7 depth ${claw.depth}`}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.classes}`}>
          {badge.text}
        </span>
      </div>

      {/* Mission */}
      <p className="text-xs text-text-secondary dark:text-dark-text-secondary line-clamp-2 mb-3">
        {claw.mission}
      </p>

      {/* Stats */}
      {claw.session && (
        <div className="flex items-center gap-3 text-xs text-text-muted dark:text-dark-text-muted mb-3">
          <span title="Cycles">{claw.session.cyclesCompleted} cycles</span>
          <span title="Tool calls">{claw.session.totalToolCalls} calls</span>
          <span title="Cost">{formatCost(claw.session.totalCostUsd)}</span>
        </div>
      )}

      {/* Escalation Banner */}
      {isEscalation && claw.session?.pendingEscalation && (
        <div className="mb-3 p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
          <p className="text-xs text-purple-600 dark:text-purple-400 font-medium">
            {claw.session.pendingEscalation.type}: {claw.session.pendingEscalation.reason}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); onApproveEscalation(); }}
            className="mt-1.5 px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors"
          >
            Approve
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 pt-2 border-t border-border dark:border-dark-border">
        {!isRunning && !isPaused && !isEscalation && (
          <button
            onClick={(e) => { e.stopPropagation(); onStart(); }}
            className="p-1.5 rounded hover:bg-green-500/10 transition-colors"
            title="Start"
          >
            <Play className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
          </button>
        )}
        {isRunning && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onPause(); }}
              className="p-1.5 rounded hover:bg-amber-500/10 transition-colors"
              title="Pause"
            >
              <Pause className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onStop(); }}
              className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            </button>
          </>
        )}
        {isPaused && (
          <button
            onClick={(e) => { e.stopPropagation(); onResume(); }}
            className="p-1.5 rounded hover:bg-green-500/10 transition-colors"
            title="Resume"
          >
            <Play className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={(e) => { e.stopPropagation(); onClone(); }}
          className="p-1.5 rounded hover:bg-blue-500/10 transition-colors"
          title="Clone"
        >
          <Copy className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// ClawManagementPanel — Full management sidebar with tabs
// =============================================================================

interface ClawOutputEvent {
  clawId: string;
  message?: string;
  type?: string;
  title?: string;
  summary?: string;
  urgency?: string;
  timestamp: string;
}

type DetailTab = 'overview' | 'settings' | 'skills' | 'files' | 'history' | 'audit' | 'output' | 'conversation';

const DETAIL_TABS: { id: DetailTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'skills', label: 'Skills', icon: Puzzle },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'audit', label: 'Audit', icon: FileText },
  { id: 'output', label: 'Output', icon: Send },
  { id: 'conversation', label: 'Chat', icon: Bot },
];

function ClawManagementPanel({
  claw,
  onClose,
  onUpdate,
}: {
  claw: ClawConfig;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [history, setHistory] = useState<ClawHistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [outputFeed, setOutputFeed] = useState<ClawOutputEvent[]>([]);
  const [message, setMessage] = useState('');

  // Settings form state
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
  const [isSaving, setIsSaving] = useState(false);

  // Skills state
  const [availableSkills, setAvailableSkills] = useState<Array<{ id: string; name: string; toolCount: number }>>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(claw.skills ?? []);
  const [isSavingSkills, setIsSavingSkills] = useState(false);

  // Conversation state
  const [conversation, setConversation] = useState<Array<{ role: string; content: string; createdAt?: string }>>([]);
  const [isLoadingConvo, setIsLoadingConvo] = useState(false);

  // Audit state
  const [auditEntries, setAuditEntries] = useState<Array<{
    id: string; toolName: string; toolArgs: Record<string, unknown>; toolResult: string;
    success: boolean; durationMs: number; category: string; cycleNumber: number; executedAt: string;
  }>>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilter, setAuditFilter] = useState('');
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // Files state
  const [workspaceFiles, setWorkspaceFiles] = useState<Array<{ name: string; path: string; isDirectory: boolean; size: number; modifiedAt: string }>>([]);
  const [currentFilePath, setCurrentFilePath] = useState('');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // Models state
  const [models, setModels] = useState<Array<{ id: string; name: string; provider: string; recommended?: boolean }>>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);

  const toast = useToast();
  const { subscribe } = useGateway();

  // Reset state when claw changes
  useEffect(() => {
    setHistory([]);
    setHistoryTotal(0);
    setOutputFeed([]);
    setTab('overview');
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
    setSelectedSkills(claw.skills ?? []);
    setWorkspaceFiles([]);
    setCurrentFilePath('');
    setFileContent(null);
    setViewingFile(null);
    setConversation([]);
    setAuditEntries([]);
    setAuditTotal(0);
    setAuditFilter('');
  }, [claw.id]);

  // WS output feed
  useEffect(() => {
    const unsub = subscribe<ClawOutputEvent>('claw.output', (p) => {
      if (p.clawId === claw.id) setOutputFeed((prev) => [p, ...prev].slice(0, 50));
    });
    return () => unsub();
  }, [subscribe, claw.id]);

  // Load history on tab switch
  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, claw.id]);

  // Load audit log on audit tab
  const loadAudit = useCallback(async (cat?: string) => {
    setIsLoadingAudit(true);
    try {
      const qs = cat ? `?limit=50&category=${cat}` : '?limit=50';
      const res = await authedFetch(`/api/v1/claws/${claw.id}/audit${qs}`);
      if (res.ok) {
        const body = await res.json();
        setAuditEntries(body.data?.entries ?? []);
        setAuditTotal(body.data?.total ?? 0);
      }
    } catch { /* ignore */ }
    finally { setIsLoadingAudit(false); }
  }, [claw.id]);

  useEffect(() => {
    if (tab === 'audit') loadAudit(auditFilter || undefined);
  }, [tab, claw.id, auditFilter]);

  // Load conversation on conversation tab
  useEffect(() => {
    if (tab === 'conversation') {
      setIsLoadingConvo(true);
      authedFetch(`/api/v1/chat/claw-${claw.id}/messages?limit=50`)
        .then((r) => r.ok ? r.json() : { data: [] })
        .then((body) => setConversation(body.data ?? []))
        .catch(() => setConversation([]))
        .finally(() => setIsLoadingConvo(false));
    }
  }, [tab, claw.id]);

  // Load files on files tab
  const loadFiles = useCallback(async (subPath = '') => {
    if (!claw.workspaceId) return;
    setIsLoadingFiles(true);
    try {
      const { fileWorkspacesApi } = await import('../api/endpoints/misc');
      const data = await fileWorkspacesApi.files(claw.workspaceId, subPath || undefined);
      setWorkspaceFiles(data.files ?? []);
      setCurrentFilePath(subPath);
      setFileContent(null);
      setViewingFile(null);
    } catch { toast.error('Failed to load files'); }
    finally { setIsLoadingFiles(false); }
  }, [claw.workspaceId, toast]);

  const loadFileContent = async (filePath: string) => {
    if (!claw.workspaceId) return;
    try {
      const res = await authedFetch(`/api/v1/file-workspaces/${claw.workspaceId}/file/${filePath}?raw=true`);
      if (!res.ok) { setFileContent('(failed to read file)'); return; }
      const text = await res.text();
      setFileContent(text);
      setViewingFile(filePath);
    } catch { setFileContent('(failed to read file)'); }
  };

  useEffect(() => {
    if (tab === 'files' && workspaceFiles.length === 0 && claw.workspaceId) loadFiles();
  }, [tab, claw.workspaceId]);

  // Load models on settings tab
  useEffect(() => {
    if ((tab === 'settings' || tab === 'overview') && models.length === 0) {
      import('../api/endpoints/models').then(({ modelsApi }) =>
        modelsApi.list().then((data) => {
          setModels(data.models);
          setConfiguredProviders(data.configuredProviders);
        })
      ).catch(() => {});
    }
  }, [tab]);

  // Load skills on tab switch
  useEffect(() => {
    if (tab === 'skills' && availableSkills.length === 0) {
      import('../api/endpoints/extensions').then(({ extensionsApi }) =>
        extensionsApi.list({ status: 'enabled' }).then((exts) =>
          setAvailableSkills(exts.map((e) => ({ id: e.id, name: e.name, toolCount: e.toolCount })))
        )
      ).catch(() => {});
    }
  }, [tab]);

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const { entries, total } = await clawsApi.getHistory(claw.id, 20);
      setHistory(entries);
      setHistoryTotal(total);
    } catch { toast.error('Failed to load history'); }
    finally { setIsLoadingHistory(false); }
  };

  const sendMsg = async () => {
    if (!message.trim()) return;
    try {
      await clawsApi.sendMessage(claw.id, message.trim());
      toast.success('Message sent');
      setMessage('');
    } catch { toast.error('Failed to send'); }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      await clawsApi.update(claw.id, {
        mission: editMission,
        mode: editMode,
        sandbox: editSandbox,
        coding_agent_provider: editCodingAgent || undefined,
        provider: editProvider || undefined,
        model: editModel || undefined,
        interval_ms: editMode === 'interval' ? editIntervalMs : undefined,
        event_filters: editMode === 'event' && editEventFilters.trim()
          ? editEventFilters.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        auto_start: editAutoStart,
        stop_condition: editStopCondition || undefined,
        limits: { ...claw.limits, totalBudgetUsd: editBudget > 0 ? editBudget : undefined },
      });
      toast.success('Settings saved');
      onUpdate();
    } catch { toast.error('Failed to save'); }
    finally { setIsSaving(false); }
  };

  const saveSkills = async () => {
    setIsSavingSkills(true);
    try {
      await clawsApi.update(claw.id, { skills: selectedSkills });
      toast.success('Skills updated');
      onUpdate();
    } catch { toast.error('Failed to update skills'); }
    finally { setIsSavingSkills(false); }
  };

  const badge = getStateBadge(claw.session?.state ?? null);
  const ic = 'w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary';
  const lbl = 'block text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider mb-1';

  return (
    <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-sm animate-fade-in-up">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border dark:border-dark-border flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <h3 className="text-base font-semibold text-text-primary dark:text-dark-text-primary truncate">{claw.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${badge.classes}`}>{badge.text}</span>
          </div>
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 truncate">{claw.id} · {claw.mode} · sandbox: {claw.sandbox}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary ml-2" title="Close">
          <X className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border dark:border-dark-border px-4 overflow-x-auto">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              tab === t.id ? 'border-primary text-primary' : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-5 space-y-4 max-h-[600px] overflow-y-auto">

        {/* ===== OVERVIEW TAB ===== */}
        {tab === 'overview' && (
          <>
            {/* Live status banner */}
            {claw.session && ['running', 'starting'].includes(claw.session.state) && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    Claw is running
                    {claw.session.lastCycleAt && ` · last cycle ${timeAgo(claw.session.lastCycleAt)}`}
                  </p>
                  <p className="text-xs text-green-600/70 dark:text-green-500/70">
                    Mode: {claw.mode}
                    {claw.mode === 'interval' && claw.intervalMs && ` · every ${Math.round((claw.intervalMs) / 1000)}s`}
                    {claw.mode === 'event' && ' · waiting for events'}
                  </p>
                </div>
              </div>
            )}
            {claw.session?.state === 'waiting' && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <div className="relative flex h-3 w-3">
                  <span className="animate-pulse relative inline-flex rounded-full h-3 w-3 bg-cyan-500" />
                </div>
                <p className="text-sm text-cyan-700 dark:text-cyan-400">
                  Waiting for event{claw.eventFilters?.length ? `: ${claw.eventFilters.join(', ')}` : ''}
                </p>
              </div>
            )}
            {claw.session?.lastCycleError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-xs text-red-600 dark:text-red-400 truncate">Last error: {claw.session.lastCycleError}</p>
              </div>
            )}

            {/* Mission */}
            <div>
              <p className={lbl}>Mission</p>
              <p className="text-sm text-text-secondary dark:text-dark-text-secondary">{claw.mission}</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Cycles', value: claw.session?.cyclesCompleted ?? 0 },
                { label: 'Tool Calls', value: claw.session?.totalToolCalls ?? 0 },
                { label: 'Cost', value: formatCost(claw.session?.totalCostUsd ?? 0) },
                { label: 'Last Cycle', value: claw.session?.lastCycleDurationMs ? formatDuration(claw.session.lastCycleDurationMs) : '-' },
              ].map((s) => (
                <div key={s.label} className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3">
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">{s.label}</p>
                  <p className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Config tags */}
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">{claw.mode}</span>
              <span className="px-2 py-0.5 bg-gray-500/10 text-gray-600 dark:text-gray-400 rounded-full">sandbox: {claw.sandbox}</span>
              {claw.provider && <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full">{claw.provider}{claw.model ? ` / ${claw.model}` : ''}</span>}
              {!claw.provider && <span className="px-2 py-0.5 bg-gray-500/10 text-gray-500 rounded-full">system model</span>}
              {claw.codingAgentProvider && <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">{claw.codingAgentProvider}</span>}
              {claw.soulId && <span className="px-2 py-0.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-full">soul</span>}
              {claw.autoStart && <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-full">auto-start</span>}
              {(claw.skills?.length ?? 0) > 0 && <span className="px-2 py-0.5 bg-pink-500/10 text-pink-600 dark:text-pink-400 rounded-full">{claw.skills!.length} skills</span>}
              {claw.depth > 0 && <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-full">depth {claw.depth}</span>}
              {claw.session?.artifacts && claw.session.artifacts.length > 0 && (
                <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">{claw.session.artifacts.length} artifacts</span>
              )}
            </div>

            {/* Workspace link */}
            {claw.workspaceId && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
                <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">Workspace</p>
                  <p className="text-sm text-text-primary dark:text-dark-text-primary truncate font-mono">{claw.workspaceId}</p>
                </div>
                <button onClick={() => setTab('files')} className="text-xs text-primary hover:underline shrink-0">Browse Files</button>
                <a href={`/api/v1/file-workspaces/${claw.workspaceId}/download`}
                  className="text-xs text-primary hover:underline shrink-0">Download ZIP</a>
              </div>
            )}

            {/* Artifacts list */}
            {claw.session?.artifacts && claw.session.artifacts.length > 0 && (
              <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
                <p className={lbl}>Artifacts ({claw.session.artifacts.length})</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {claw.session.artifacts.map((artId) => (
                    <a key={artId} href={`/artifacts?id=${artId}`}
                      className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded hover:bg-emerald-500/20 transition-colors font-mono">
                      {artId.slice(0, 12)}...
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Escalation banner */}
            {claw.session?.state === 'escalation_pending' && claw.session.pendingEscalation && (
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <p className="text-sm font-medium text-purple-600 dark:text-purple-400">Escalation Pending</p>
                <p className="text-xs text-purple-500 mt-1">{claw.session.pendingEscalation.type}: {claw.session.pendingEscalation.reason}</p>
              </div>
            )}

            {/* Message input */}
            {claw.session && ['running', 'waiting', 'paused'].includes(claw.session.state) && (
              <div className="flex items-center gap-2">
                <input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMsg()}
                  placeholder="Send a message..." className={`flex-1 ${ic} placeholder:text-text-muted`} />
                <button onClick={sendMsg} className="p-2 rounded-lg bg-primary text-white hover:bg-primary/90"><Send className="w-4 h-4" /></button>
              </div>
            )}
          </>
        )}

        {/* ===== SETTINGS TAB ===== */}
        {tab === 'settings' && (
          <>
            <div><label className={lbl}>Mission</label>
              <textarea value={editMission} onChange={(e) => setEditMission(e.target.value)} rows={3} className={`${ic} resize-none`} /></div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><label className={lbl}>Mode</label>
                <select value={editMode} onChange={(e) => setEditMode(e.target.value as typeof editMode)} className={ic}>
                  <option value="single-shot">Single-shot</option><option value="continuous">Continuous</option>
                  <option value="interval">Interval</option><option value="event">Event-driven</option>
                </select></div>
              <div><label className={lbl}>Sandbox</label>
                <select value={editSandbox} onChange={(e) => setEditSandbox(e.target.value as typeof editSandbox)} className={ic}>
                  <option value="auto">Auto</option><option value="docker">Docker</option><option value="local">Local</option>
                </select></div>
              <div><label className={lbl}>Coding Agent</label>
                <select value={editCodingAgent} onChange={(e) => setEditCodingAgent(e.target.value)} className={ic}>
                  <option value="">None</option><option value="claude-code">Claude Code</option>
                  <option value="codex">Codex CLI</option><option value="gemini-cli">Gemini CLI</option>
                </select></div>
              <div><label className={lbl}>Budget (USD)</label>
                <input type="number" value={editBudget} onChange={(e) => setEditBudget(Number(e.target.value))} min={0} step={0.1} className={ic} /></div>
            </div>

            {/* Provider / Model */}
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>AI Provider</label>
                <select value={editProvider} onChange={(e) => { setEditProvider(e.target.value); setEditModel(''); }} className={ic}>
                  <option value="">System Default</option>
                  {configuredProviders.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select></div>
              <div><label className={lbl}>AI Model</label>
                <select value={editModel} onChange={(e) => setEditModel(e.target.value)} className={ic}>
                  <option value="">System Default</option>
                  {models
                    .filter((m) => !editProvider || m.provider === editProvider)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}{m.recommended ? ' *' : ''}{editProvider ? '' : ` (${m.provider})`}
                      </option>
                    ))}
                </select></div>
            </div>
            {!editProvider && (
              <p className="text-xs text-text-muted dark:text-dark-text-muted -mt-2">
                Using system model routing (pulse process). Set a specific provider/model to override.
              </p>
            )}

            {editMode === 'interval' && (
              <div><label className={lbl}>Interval (seconds)</label>
                <input type="number" value={Math.round(editIntervalMs / 1000)} onChange={(e) => setEditIntervalMs(Number(e.target.value) * 1000)} min={10} className={ic} /></div>
            )}
            {editMode === 'event' && (
              <div><label className={lbl}>Event Filters (comma-separated)</label>
                <input value={editEventFilters} onChange={(e) => setEditEventFilters(e.target.value)} placeholder="user.message, webhook.received" className={ic} /></div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Stop Condition</label>
                <input value={editStopCondition} onChange={(e) => setEditStopCondition(e.target.value)} placeholder="e.g., max_cycles:100" className={ic} /></div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editAutoStart} onChange={(e) => setEditAutoStart(e.target.checked)} className="w-4 h-4 rounded accent-primary" />
                  <span className="text-sm text-text-primary dark:text-dark-text-primary">Auto-start on boot</span>
                </label>
              </div>
            </div>

            <button onClick={saveSettings} disabled={isSaving}
              className="flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50">
              <Save className="w-4 h-4" />{isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </>
        )}

        {/* ===== SKILLS TAB ===== */}
        {tab === 'skills' && (
          <>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Select which skills (extensions) this claw can use. Each skill provides specialized tools.
            </p>
            {availableSkills.length === 0 ? (
              <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">No skills installed. Install skills from the Skills Hub.</p>
            ) : (
              <div className="space-y-1">
                {availableSkills.map((sk) => (
                  <label key={sk.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                      selectedSkills.includes(sk.id) ? 'bg-primary/10 border border-primary/20' : 'hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary border border-transparent'
                    }`}>
                    <input type="checkbox" checked={selectedSkills.includes(sk.id)}
                      onChange={() => setSelectedSkills((p) => p.includes(sk.id) ? p.filter((s) => s !== sk.id) : [...p, sk.id])}
                      className="w-4 h-4 rounded accent-primary" />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">{sk.name}</span>
                      <span className="text-xs text-text-muted dark:text-dark-text-muted ml-2">{sk.toolCount} tools</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <button onClick={saveSkills} disabled={isSavingSkills}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50">
              <Save className="w-4 h-4" />{isSavingSkills ? 'Saving...' : `Save Skills (${selectedSkills.length})`}
            </button>
          </>
        )}

        {/* ===== HISTORY TAB ===== */}
        {tab === 'history' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-muted dark:text-dark-text-muted">{historyTotal} total entries</p>
              <button onClick={loadHistory} className="text-xs text-primary hover:underline">Refresh</button>
            </div>
            {isLoadingHistory ? <LoadingSpinner message="Loading..." /> : history.length === 0 ? (
              <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">No history yet.</p>
            ) : (
              <div className="space-y-2">
                {history.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary">
                    {entry.success ? <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                        <span>Cycle {entry.cycleNumber}</span><span>{formatDuration(entry.durationMs)}</span>
                        {entry.costUsd !== undefined && <span>{formatCost(entry.costUsd)}</span>}
                        <span>{entry.toolCalls.length} tools</span>
                        {entry.entryType === 'escalation' && <span className="text-purple-500">escalation</span>}
                      </div>
                      <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-1 line-clamp-3">
                        {entry.error ?? entry.outputMessage.slice(0, 300)}
                      </p>
                    </div>
                    <span className="text-xs text-text-muted dark:text-dark-text-muted shrink-0">{timeAgo(entry.executedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ===== AUDIT TAB ===== */}
        {tab === 'audit' && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <p className="text-xs text-text-muted dark:text-dark-text-muted">{auditTotal} tool calls logged</p>
              <div className="flex-1" />
              <select
                value={auditFilter}
                onChange={(e) => setAuditFilter(e.target.value)}
                className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
              >
                <option value="">All categories</option>
                <option value="claw">Claw tools</option>
                <option value="cli">CLI tools</option>
                <option value="browser">Browser</option>
                <option value="coding-agent">Coding agents</option>
                <option value="web">Web/API</option>
                <option value="code-exec">Code execution</option>
                <option value="git">Git</option>
                <option value="filesystem">Filesystem</option>
                <option value="knowledge">Knowledge (memory/goals)</option>
                <option value="tool">Other tools</option>
              </select>
              <button onClick={() => loadAudit(auditFilter || undefined)} className="text-xs text-primary hover:underline">Refresh</button>
            </div>

            {isLoadingAudit ? <LoadingSpinner message="Loading audit log..." /> : auditEntries.length === 0 ? (
              <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">No audit entries yet.</p>
            ) : (
              <div className="space-y-1.5">
                {auditEntries.map((entry) => {
                  const catColors: Record<string, string> = {
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
                  return (
                    <div key={entry.id} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary text-xs">
                      {entry.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-medium text-text-primary dark:text-dark-text-primary">{entry.toolName}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${catColors[entry.category] ?? catColors.tool}`}>
                            {entry.category}
                          </span>
                          <span className="text-text-muted dark:text-dark-text-muted">
                            cycle {entry.cycleNumber} · {formatDuration(entry.durationMs)}
                          </span>
                        </div>
                        {Object.keys(entry.toolArgs).length > 0 && (
                          <p className="text-text-muted dark:text-dark-text-muted mt-0.5 truncate font-mono">
                            {JSON.stringify(entry.toolArgs).slice(0, 120)}
                          </p>
                        )}
                        {entry.toolResult && !entry.success && (
                          <p className="text-red-500 mt-0.5 truncate">{entry.toolResult.slice(0, 100)}</p>
                        )}
                      </div>
                      <span className="text-text-muted dark:text-dark-text-muted shrink-0">{timeAgo(entry.executedAt)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ===== FILES TAB ===== */}
        {tab === 'files' && (
          <>
            {!claw.workspaceId ? (
              <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">No workspace assigned. Start the claw to create one.</p>
            ) : (
              <FileBrowser
                workspaceId={claw.workspaceId!}
                currentPath={currentFilePath}
                files={workspaceFiles}
                isLoading={isLoadingFiles}
                onNavigate={loadFiles}
                onOpenFile={loadFileContent}
                onRefresh={() => loadFiles(currentFilePath)}
                onFileCreated={() => loadFiles(currentFilePath)}
              />
            )}
            {/* File Editor Modal */}
            {viewingFile && claw.workspaceId && (
              <FileEditorModal
                workspaceId={claw.workspaceId}
                filePath={viewingFile}
                content={fileContent}
                onClose={() => { setViewingFile(null); setFileContent(null); }}
                onSaved={() => { toast.success('File saved'); loadFiles(currentFilePath); }}
              />
            )}
          </>
        )}

        {/* ===== OUTPUT TAB ===== */}
        {tab === 'output' && (
          <>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Live output from claw_send_output and claw_complete_report tool calls.
            </p>
            {outputFeed.length === 0 ? (
              <p className="text-sm text-text-muted dark:text-dark-text-muted py-8 text-center">No output yet. The claw will send results here as it works.</p>
            ) : (
              <div className="space-y-2">
                {outputFeed.map((evt, i) => (
                  <div key={`${evt.timestamp}-${i}`} className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                    {evt.type === 'report' ? (
                      <div>
                        <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">{evt.title}</p>
                        <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-1">{evt.summary}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-text-primary dark:text-dark-text-primary whitespace-pre-wrap">{evt.message}</p>
                    )}
                    <span className="text-xs text-text-muted dark:text-dark-text-muted mt-1 block">{timeAgo(evt.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ===== CONVERSATION TAB ===== */}
        {tab === 'conversation' && (
          <>
            <p className="text-xs text-text-muted dark:text-dark-text-muted mb-3">
              Messages stored by claw_send_output and claw_complete_report in the claw's conversation.
            </p>
            {isLoadingConvo ? <LoadingSpinner message="Loading..." /> : conversation.length === 0 ? (
              <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">No conversation messages yet. The claw will write here when it uses claw_send_output or claw_complete_report.</p>
            ) : (
              <div className="space-y-3">
                {conversation.map((msg, i) => (
                  <div key={i} className={`p-3 rounded-lg ${
                    msg.role === 'assistant'
                      ? 'bg-primary/5 border border-primary/10'
                      : 'bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase">{msg.role}</span>
                      {msg.createdAt && <span className="text-xs text-text-muted dark:text-dark-text-muted">{timeAgo(msg.createdAt)}</span>}
                    </div>
                    <div className="text-sm text-text-primary dark:text-dark-text-primary whitespace-pre-wrap leading-relaxed">
                      {msg.content.length > 2000 ? msg.content.slice(0, 2000) + '...' : msg.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}

// =============================================================================
// FileBrowser — workspace file browser with new file creation
// =============================================================================

function FileBrowser({
  workspaceId,
  currentPath,
  files,
  isLoading,
  onNavigate,
  onOpenFile,
  onRefresh,
  onFileCreated,
}: {
  workspaceId: string;
  currentPath: string;
  files: Array<{ name: string; path: string; isDirectory: boolean; size: number; modifiedAt: string }>;
  isLoading: boolean;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
  onRefresh: () => void;
  onFileCreated: () => void;
}) {
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const toast = useToast();

  const createFile = async () => {
    if (!newFileName.trim()) { toast.error('File name required'); return; }
    setIsCreating(true);
    try {
      const fullPath = currentPath ? `${currentPath}/${newFileName.trim()}` : newFileName.trim();
      const res = await authedFetch(`/api/v1/file-workspaces/${workspaceId}/file/${fullPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: newFileContent,
      });
      if (!res.ok) throw new Error('Create failed');
      toast.success(`Created ${newFileName.trim()}`);
      setShowNewFile(false);
      setNewFileName('');
      setNewFileContent('');
      onFileCreated();
    } catch { toast.error('Failed to create file'); }
    finally { setIsCreating(false); }
  };

  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        {currentPath && (
          <button onClick={() => onNavigate(currentPath.split('/').slice(0, -1).join('/'))}
            className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary">
            <ArrowLeft className="w-4 h-4 text-text-muted" />
          </button>
        )}
        <FolderOpen className="w-4 h-4 text-text-muted shrink-0" />
        <span className="text-sm text-text-muted dark:text-dark-text-muted truncate">
          {currentPath ? `/${currentPath}` : '/'}
        </span>
        <div className="flex-1" />
        <button onClick={() => setShowNewFile(!showNewFile)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20">
          <Plus className="w-3 h-3" /> New File
        </button>
        <button onClick={onRefresh} className="text-xs text-primary hover:underline">Refresh</button>
        <a href={`/api/v1/file-workspaces/${workspaceId}/download`}
          className="text-xs text-primary hover:underline">ZIP</a>
      </div>

      {/* New file form */}
      {showNewFile && (
        <div className="mb-3 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border space-y-2">
          <input value={newFileName} onChange={(e) => setNewFileName(e.target.value)} placeholder="filename.md"
            className="w-full px-3 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary" />
          <textarea value={newFileContent} onChange={(e) => setNewFileContent(e.target.value)} placeholder="File content (optional)..." rows={3}
            className="w-full px-3 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary resize-none font-mono" />
          <div className="flex gap-2">
            <button onClick={createFile} disabled={isCreating}
              className="px-3 py-1 text-xs rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
              {isCreating ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => { setShowNewFile(false); setNewFileName(''); setNewFileContent(''); }}
              className="px-3 py-1 text-xs rounded text-text-muted hover:text-text-primary">Cancel</button>
          </div>
        </div>
      )}

      {/* File list */}
      {isLoading ? <LoadingSpinner message="Loading files..." /> : sorted.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          {currentPath ? 'Empty directory.' : 'Workspace is empty. Create files or start the claw.'}
        </p>
      ) : (
        <div className="space-y-1">
          {sorted.map((file) => (
            <button
              key={file.path}
              onClick={() => {
                const fPath = currentPath ? `${currentPath}/${file.name}` : file.name;
                file.isDirectory ? onNavigate(fPath) : onOpenFile(fPath);
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors text-left"
            >
              {file.isDirectory ? (
                <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
              ) : (
                <FileText className="w-4 h-4 text-text-muted dark:text-dark-text-muted shrink-0" />
              )}
              <span className="flex-1 text-sm text-text-primary dark:text-dark-text-primary truncate">
                {file.name}{file.isDirectory ? '/' : ''}
              </span>
              {!file.isDirectory && (
                <span className="text-xs text-text-muted dark:text-dark-text-muted shrink-0">
                  {file.size < 1024 ? `${file.size} B` : file.size < 1048576 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1048576).toFixed(1)} MB`}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// FileEditorModal — full-screen code editor modal
// =============================================================================

function FileEditorModal({
  workspaceId,
  filePath,
  content,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  filePath: string;
  content: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditable = /\.(md|txt|json|yaml|yml|js|ts|py|sh|css|html|csv|xml|toml|ini|cfg|env|log)$/i.test(filePath);
  const isClawFile = filePath.startsWith('.claw/');
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(content ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  useEffect(() => { setEditContent(content ?? ''); }, [content]);

  // Keyboard shortcut: Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && editing) {
        e.preventDefault();
        saveFile();
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const saveFile = async () => {
    setIsSaving(true);
    try {
      const res = await authedFetch(`/api/v1/file-workspaces/${workspaceId}/file/${filePath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: editContent,
      });
      if (!res.ok) throw new Error('Save failed');
      setEditing(false);
      onSaved();
    } catch { toast.error('Failed to save file'); }
    finally { setIsSaving(false); }
  };

  const fileName = filePath.split('/').pop() ?? filePath;
  const lineCount = (content ?? '').split('\n').length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex-1 flex flex-col m-4 md:m-8 lg:mx-16 lg:my-8 bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-2xl border border-border dark:border-dark-border overflow-hidden animate-fade-in-up">

        {/* Title bar */}
        <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border">
          <FileText className="w-4 h-4 text-text-muted shrink-0" />
          <span className="text-sm font-mono font-medium text-text-primary dark:text-dark-text-primary">{fileName}</span>
          <span className="text-xs text-text-muted dark:text-dark-text-muted truncate">{filePath}</span>
          {isClawFile && <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded font-medium">directive</span>}
          <div className="flex-1" />
          <span className="text-xs text-text-muted dark:text-dark-text-muted">{lineCount} lines</span>

          {/* Actions */}
          {isEditable && !editing && (
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 font-medium transition-colors">
              Edit
            </button>
          )}
          {editing && (
            <>
              <button onClick={saveFile} disabled={isSaving}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50 font-medium">
                <Save className="w-3 h-3" />{isSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setEditing(false); setEditContent(content ?? ''); }}
                className="px-2 py-1 text-xs rounded-md text-text-muted hover:text-text-primary">
                Cancel
              </button>
            </>
          )}
          <a href={`/api/v1/file-workspaces/${workspaceId}/file/${filePath}?download=true`}
            className="p-1.5 rounded-md hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary" title="Download">
            <Download className="w-4 h-4 text-text-muted" />
          </a>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary" title="Close (Esc)">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Editor / Viewer */}
        <div className="flex-1 overflow-hidden">
          {editing ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-full p-4 text-sm font-mono bg-[#1e1e2e] text-[#cdd6f4] border-none resize-none focus:outline-none leading-relaxed"
              spellCheck={false}
              autoFocus
            />
          ) : (
            <div className="h-full overflow-auto">
              <pre className="p-4 text-sm font-mono bg-[#1e1e2e] text-[#cdd6f4] min-h-full leading-relaxed whitespace-pre-wrap">
                {content ?? 'Loading...'}
              </pre>
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-4 px-4 py-1.5 bg-bg-secondary dark:bg-dark-bg-secondary border-t border-border dark:border-dark-border text-xs text-text-muted dark:text-dark-text-muted">
          <span>{editing ? 'Editing' : 'Read-only'}</span>
          {editing && <span>Ctrl+S to save · Esc to close</span>}
          <div className="flex-1" />
          <span>{(content ?? '').length.toLocaleString()} chars</span>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// CreateClawModal
// =============================================================================

const CLAW_TEMPLATES: Array<{
  name: string;
  icon: string;
  mission: string;
  mode: 'continuous' | 'interval' | 'event' | 'single-shot';
  sandbox: 'auto' | 'docker' | 'local';
  codingAgent?: string;
  description: string;
}> = [
  {
    name: 'Research Agent',
    icon: '🔍',
    mission: 'Research the given topic thoroughly using web search, browse relevant pages, extract key information, and compile a comprehensive report with sources.',
    mode: 'single-shot',
    sandbox: 'auto',
    description: 'Web research with final report',
  },
  {
    name: 'Code Reviewer',
    icon: '🔎',
    mission: 'Review the codebase for quality issues, security vulnerabilities, performance problems, and best practice violations. Use CLI tools (eslint, tsc) and coding agents to analyze. Produce a detailed review report.',
    mode: 'single-shot',
    sandbox: 'local',
    codingAgent: 'claude-code',
    description: 'Deep code review with CLI tools',
  },
  {
    name: 'Data Analyst',
    icon: '📊',
    mission: 'Analyze the provided data using Python scripts. Install necessary packages (pandas, matplotlib), process data, generate charts as artifacts, and write an analysis report.',
    mode: 'single-shot',
    sandbox: 'docker',
    description: 'Python-powered data analysis',
  },
  {
    name: 'Monitor & Alert',
    icon: '🔔',
    mission: 'Periodically check the specified URLs/APIs for availability, response time, and content changes. Send alerts via claw_send_output when issues are detected.',
    mode: 'interval',
    sandbox: 'auto',
    description: 'Periodic health checks with alerts',
  },
  {
    name: 'Content Creator',
    icon: '✍️',
    mission: 'Create high-quality content based on the brief. Research the topic, write drafts, refine, and publish final content as artifacts. Support HTML, Markdown, and SVG formats.',
    mode: 'single-shot',
    sandbox: 'auto',
    description: 'Write and publish content',
  },
  {
    name: 'Event Reactor',
    icon: '⚡',
    mission: 'Listen for system events and react intelligently. Process incoming data, make decisions, update goals, and coordinate with other claws via messaging.',
    mode: 'event',
    sandbox: 'auto',
    description: 'Event-driven reactive automation',
  },
];

function CreateClawModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [mode, setMode] = useState<'continuous' | 'interval' | 'event' | 'single-shot'>('single-shot');
  const [sandbox, setSandbox] = useState<'auto' | 'docker' | 'local'>('auto');
  const [eventFilters, setEventFilters] = useState('');
  const [codingAgent, setCodingAgent] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [availableSkills, setAvailableSkills] = useState<Array<{ id: string; name: string; description?: string; toolCount: number }>>([]);
  const [createModels, setCreateModels] = useState<Array<{ id: string; name: string; provider: string; recommended?: boolean }>>([]);
  const [createProviders, setCreateProviders] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();

  // Load available skills + models on mount
  useEffect(() => {
    import('../api/endpoints/models').then(({ modelsApi }) =>
      modelsApi.list().then((data) => {
        setCreateModels(data.models);
        setCreateProviders(data.configuredProviders);
      })
    ).catch(() => {});
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const { extensionsApi } = await import('../api/endpoints/extensions');
        const exts = await extensionsApi.list({ status: 'enabled' });
        setAvailableSkills(
          exts.map((e) => ({
            id: e.id,
            name: e.name,
            description: e.description,
            toolCount: e.toolCount,
          }))
        );
      } catch {
        // Skills may not be available
      }
    };
    load();
  }, []);

  const toggleSkill = (id: string) => {
    setSelectedSkills((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (!name.trim() || !mission.trim()) {
      toast.error('Name and mission are required');
      return;
    }
    setIsSubmitting(true);
    try {
      await clawsApi.create({
        name: name.trim(),
        mission: mission.trim(),
        mode,
        sandbox,
        provider: provider || undefined,
        model: model || undefined,
        coding_agent_provider: codingAgent || undefined,
        skills: selectedSkills.length > 0 ? selectedSkills : undefined,
        event_filters: mode === 'event' && eventFilters.trim()
          ? eventFilters.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
      });
      toast.success('Claw created');
      onCreated();
    } catch {
      toast.error('Failed to create claw');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl border border-border dark:border-dark-border w-full max-w-xl mx-4 p-6 animate-fade-in-up max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Create Claw
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Templates */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
              Start from template
            </label>
            <div className="grid grid-cols-3 gap-2">
              {CLAW_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => {
                    setName(tpl.name);
                    setMission(tpl.mission);
                    setMode(tpl.mode);
                    setSandbox(tpl.sandbox);
                    if (tpl.codingAgent) setCodingAgent(tpl.codingAgent);
                  }}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all text-center ${
                    name === tpl.name
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border dark:border-dark-border hover:border-primary/40 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                  }`}
                >
                  <span className="text-xl">{tpl.icon}</span>
                  <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary">{tpl.name}</span>
                  <span className="text-[10px] text-text-muted dark:text-dark-text-muted leading-tight">{tpl.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border dark:border-dark-border" />
            <span className="text-xs text-text-muted dark:text-dark-text-muted">or customize</span>
            <div className="flex-1 border-t border-border dark:border-dark-border" />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Market Research Agent"
              className={inputClass}
            />
          </div>

          {/* Mission */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Mission
            </label>
            <textarea
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              placeholder="Describe what this claw should accomplish..."
              rows={3}
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* Mode + Sandbox */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Mode
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'continuous' | 'interval' | 'event' | 'single-shot')}
                className={inputClass}
              >
                <option value="single-shot">Single-shot</option>
                <option value="continuous">Continuous</option>
                <option value="interval">Interval</option>
                <option value="event">Event-driven</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Sandbox
              </label>
              <select
                value={sandbox}
                onChange={(e) => setSandbox(e.target.value as 'auto' | 'docker' | 'local')}
                className={inputClass}
              >
                <option value="auto">Auto</option>
                <option value="docker">Docker</option>
                <option value="local">Local</option>
              </select>
            </div>
          </div>

          {/* Mode description */}
          <p className="text-xs text-text-muted dark:text-dark-text-muted -mt-2">
            {mode === 'single-shot' && 'Runs once, completes, and stops.'}
            {mode === 'continuous' && 'Fast adaptive loop — speeds up when active, slows when idle.'}
            {mode === 'interval' && 'Fixed interval between cycles (default 5 min).'}
            {mode === 'event' && 'Waits for events, then runs a cycle. Requires event filters.'}
          </p>

          {/* Event Filters (only for event mode) */}
          {mode === 'event' && (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Event Filters
              </label>
              <input
                value={eventFilters}
                onChange={(e) => setEventFilters(e.target.value)}
                placeholder="e.g., user.message, webhook.received, data:changed"
                className={inputClass}
              />
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                Comma-separated EventBus event types that trigger a cycle
              </p>
            </div>
          )}

          {/* Skills Picker */}
          {availableSkills.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Skills
                <span className="text-xs text-text-muted dark:text-dark-text-muted ml-1">
                  ({selectedSkills.length} selected)
                </span>
              </label>
              <div className="max-h-36 overflow-y-auto border border-border dark:border-dark-border rounded-lg p-2 space-y-1 bg-bg-secondary dark:bg-dark-bg-secondary">
                {availableSkills.map((skill) => (
                  <label
                    key={skill.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                      selectedSkills.includes(skill.id)
                        ? 'bg-primary/10 border border-primary/20'
                        : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkills.includes(skill.id)}
                      onChange={() => toggleSkill(skill.id)}
                      className="w-3.5 h-3.5 rounded border-border accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text-primary dark:text-dark-text-primary">
                        {skill.name}
                      </span>
                      <span className="text-xs text-text-muted dark:text-dark-text-muted ml-1">
                        ({skill.toolCount} tools)
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Advanced Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
          >
            {showAdvanced ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Advanced Options
          </button>

          {/* Advanced options */}
          {showAdvanced && (
            <div className="space-y-4 pl-3 border-l-2 border-border dark:border-dark-border">
              {/* Provider / Model */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    AI Provider
                  </label>
                  <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }} className={inputClass}>
                    <option value="">System Default</option>
                    {createProviders.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    AI Model
                  </label>
                  <select value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
                    <option value="">System Default</option>
                    {createModels
                      .filter((m) => !provider || m.provider === provider)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}{m.recommended ? ' *' : ''}{provider ? '' : ` (${m.provider})`}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Coding Agent */}
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Coding Agent
                </label>
                <select value={codingAgent} onChange={(e) => setCodingAgent(e.target.value)} className={inputClass}>
                  <option value="">None</option>
                  <option value="claude-code">Claude Code</option>
                  <option value="codex">Codex CLI</option>
                  <option value="gemini-cli">Gemini CLI</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
