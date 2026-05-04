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
import type { ClawConfig, ClawRecommendation } from '../api/endpoints/claws';
import { Plus, Square, Trash2, RefreshCw, Activity, Home, Zap, Wrench } from '../components/icons';

import { CreateClawModal } from './claws/CreateClawModal';
import { ClawCard } from './claws/ClawCard';
import { ClawHomeTab } from './claws/ClawHomeTab';
import { ClawManagementPanel } from './claws/ClawManagementPanel';

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
  const [recommendations, setRecommendations] = useState<ClawRecommendation[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applyingFixIds, setApplyingFixIds] = useState<Set<string>>(new Set());
  const [isApplyingBatchFixes, setIsApplyingBatchFixes] = useState(false);

  const { subscribe } = useGateway();
  const toast = useToast();
  const { confirm } = useDialog();

  const fetchClaws = useCallback(async () => {
    try {
      const [data, recs] = await Promise.all([
        clawsApi.list(),
        clawsApi.recommendations().catch(() => ({ recommendations: [] })),
      ]);
      setClaws(data);
      setRecommendations(recs.recommendations);
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

  const denyEscalation = async (id: string) => {
    try {
      await clawsApi.denyEscalation(id);
      toast.success('Escalation denied — claw resumed without the request');
      fetchClaws();
    } catch {
      toast.error('Failed to deny escalation');
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
        preset: source.preset,
        mission_contract: source.missionContract,
        autonomy_policy: source.autonomyPolicy,
      });
      toast.success(`Cloned "${source.name}"`);
      fetchClaws();
    } catch {
      toast.error('Failed to clone claw');
    }
  };

  const applySafeFixes = async (id: string) => {
    setApplyingFixIds((prev) => new Set(prev).add(id));
    try {
      const result = await clawsApi.applyRecommendations(id);
      if (result.applied.length > 0) {
        toast.success(
          `Applied ${result.applied.length} safe fix${result.applied.length === 1 ? '' : 'es'}`
        );
      } else {
        toast.success('No safe fixes needed');
      }
      if (selectedClaw?.id === id) setSelectedClaw(result.claw);
      fetchClaws();
    } catch {
      toast.error('Failed to apply safe fixes');
    } finally {
      setApplyingFixIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const applyTopSafeFixes = async () => {
    setIsApplyingBatchFixes(true);
    try {
      const ids = recommendations.slice(0, 4).map((item) => item.clawId);
      const result = await clawsApi.applyRecommendationBatch(ids);
      toast.success(`Updated ${result.updated} claw${result.updated === 1 ? '' : 's'}`);
      if (selectedClaw && ids.includes(selectedClaw.id)) setSelectedClaw(null);
      fetchClaws();
    } catch {
      toast.error('Failed to apply safe fixes');
    } finally {
      setIsApplyingBatchFixes(false);
    }
  };

  // Bulk actions
  const bulkStop = async () => {
    for (const id of selectedIds) {
      try {
        await clawsApi.stop(id);
      } catch {
        /* skip */
      }
    }
    toast.success(`Stopped ${selectedIds.size} claws`);
    setSelectedIds(new Set());
    fetchClaws();
  };

  const bulkDelete = async () => {
    const ok = await confirm({
      title: 'Delete Selected',
      message: `Delete ${selectedIds.size} claws?`,
      confirmText: 'Delete All',
      variant: 'danger',
    });
    if (!ok) return;
    for (const id of selectedIds) {
      try {
        await clawsApi.delete(id);
      } catch {
        /* skip */
      }
    }
    toast.success(`Deleted ${selectedIds.size} claws`);
    setSelectedIds(new Set());
    setSelectedClaw(null);
    fetchClaws();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });
  };

  // Filtering
  const filteredClaws = claws.filter((c) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !c.name.toLowerCase().includes(q) &&
        !c.mission.toLowerCase().includes(q) &&
        !c.id.toLowerCase().includes(q)
      )
        return false;
    }
    if (filterMode && c.mode !== filterMode) return false;
    if (filterState) {
      const state = c.session?.state ?? 'stopped';
      if (filterState === 'active' && !['running', 'starting', 'waiting'].includes(state))
        return false;
      if (
        filterState === 'attention' &&
        !['watch', 'stuck', 'expensive', 'failed'].includes(c.health?.status ?? 'healthy')
      )
        return false;
      if (filterState === 'stopped' && !['stopped', 'completed', 'failed'].includes(state))
        return false;
      if (filterState === 'paused' && state !== 'paused') return false;
    }
    return true;
  });

  const runningCount = claws.filter(
    (c) => c.session && ['running', 'starting', 'waiting'].includes(c.session.state)
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
            onClick={() => {
              setIsLoading(true);
              fetchClaws();
            }}
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
              {recommendations.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                        Needs attention
                      </p>
                      <p className="text-xs text-amber-700/70 dark:text-amber-300/70">
                        {recommendations.length} claw{recommendations.length === 1 ? '' : 's'} have
                        diagnostics or contract suggestions.
                      </p>
                    </div>
                    <button
                      onClick={() => setFilterState('attention')}
                      className="px-3 py-1 text-xs rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                    >
                      Review
                    </button>
                    <button
                      onClick={applyTopSafeFixes}
                      disabled={isApplyingBatchFixes}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      <Wrench className="w-3 h-3" />
                      {isApplyingBatchFixes ? 'Applying' : 'Fix top'}
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {recommendations.slice(0, 4).map((item) => (
                      <div
                        key={item.clawId}
                        className="text-left p-2 rounded border border-amber-500/10 bg-bg-primary dark:bg-dark-bg-primary hover:border-amber-500/30"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary truncate">
                            {item.name}
                          </span>
                          <span className="text-[11px] text-amber-600 dark:text-amber-400">
                            {item.score} - {item.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-text-muted dark:text-dark-text-muted truncate mt-0.5">
                          {item.recommendations[0] ?? item.signals[0]}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={() => {
                              const target = claws.find((c) => c.id === item.clawId);
                              if (target) setSelectedClaw(target);
                            }}
                            className="px-2 py-1 text-[11px] rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                          >
                            Review
                          </button>
                          <button
                            onClick={() => applySafeFixes(item.clawId)}
                            disabled={applyingFixIds.has(item.clawId)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                          >
                            <Wrench className="w-3 h-3" />
                            {applyingFixIds.has(item.clawId) ? 'Applying' : 'Safe fix'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, mission, or ID..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted"
                  />
                </div>
                <select
                  value={filterMode}
                  onChange={(e) => setFilterMode(e.target.value)}
                  className="px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
                >
                  <option value="">All modes</option>
                  <option value="single-shot">Single-shot</option>
                  <option value="continuous">Continuous</option>
                  <option value="interval">Interval</option>
                  <option value="event">Event</option>
                </select>
                <select
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  className="px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
                >
                  <option value="">All states</option>
                  <option value="active">Active</option>
                  <option value="attention">Needs attention</option>
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
                  <span className="text-sm font-medium text-primary">
                    {selectedIds.size} selected
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={bulkStop}
                    className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
                  >
                    <Square className="w-3 h-3" /> Stop All
                  </button>
                  <button
                    onClick={bulkDelete}
                    className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-red-500/10 text-red-600 hover:bg-red-500/20"
                  >
                    <Trash2 className="w-3 h-3" /> Delete All
                  </button>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-xs text-text-muted hover:text-text-primary"
                  >
                    Clear
                  </button>
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
                    onDenyEscalation={() => denyEscalation(claw.id)}
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
