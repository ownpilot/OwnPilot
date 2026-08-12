/**
 * Claws Page — Unified Autonomous Agent Runtime Monitor
 *
 * Follows the app's page convention: header -> tab bar -> PageHomeTab / content.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import { useDialog } from '../components/ConfirmDialog';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { clawsApi } from '../api/endpoints/claws';
import type { ClawConfig, ClawRecommendation } from '../api/endpoints/claws';
import {
  Plus,
  RefreshCw,
  Activity,
  Home,
  Zap,
  Wrench,
  Terminal,
  LayoutGrid,
  Rows3,
} from '../components/icons';
import { timeAgo } from './claws/utils';
import type { ClawOutputEvent } from './claws/tabs/OutputTab';

import { CreateClawModal } from './claws/CreateClawModal';
import { ClawCard } from './claws/ClawCard';
import { ClawListRow } from './claws/ClawListRow';
import { ClawHomeTab } from './claws/ClawHomeTab';
import { ClawManagementPanel, isDetailTab, type DetailTab } from './claws/ClawManagementPanel';
import { ConcurrencyBar } from './claws/ConcurrencyBar';
import { useClawActions } from './claws/useClawActions';
import { filterClaws, countRunning, deriveAttention } from './claws/derive';
import { BulkActionsBar } from './claws/BulkActionsBar';
import { AttentionBanners } from './claws/AttentionBanners';
import { ignoreError } from '../utils/ignore-error';
import { usePagination } from '../hooks/usePagination';

// =============================================================================
// Page
// =============================================================================

type PageTab = 'home' | 'claws';
// DetailTab is the full union exported by ClawManagementPanel — keeps the
// page-side type in sync so deep-links (?tab=plan) can pass through cleanly.
type ViewMode = 'grid' | 'list';
const VIEW_MODE_STORAGE_KEY = 'claws-view-mode';

export function ClawsPage() {
  const [pageTab, setPageTab] = useState<PageTab>('claws');
  const [claws, setClaws] = useState<ClawConfig[]>([]);
  const [totalClaws, setTotalClaws] = useState(0);
  const { page, setPage, pageSize, offset } = usePagination(24);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedClaw, setSelectedClaw] = useState<ClawConfig | null>(null);
  const [selectedDetailTab, setSelectedDetailTab] = useState<DetailTab>('overview');
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('');
  const [recommendations, setRecommendations] = useState<ClawRecommendation[]>([]);
  const [escalations, setEscalations] = useState<
    Array<{ clawId: string; name: string; type: string; reason: string; requestedAt: string }>
  >([]);
  const [outputFeed, setOutputFeed] = useState<ClawOutputEvent[]>([]);
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'grid';
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === 'list' ? 'list' : 'grid';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);
  const [llmConcurrency, setLlmConcurrency] = useState<{
    max: number;
    active: number;
    queued: number;
    slots: Array<{
      slotIdx: number;
      agentId: string;
      label: string;
      state: 'active' | 'queued' | 'free';
    }>;
  } | null>(null);

  const { subscribe } = useGateway();
  const toast = useToast();
  const { confirm } = useDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  // Honor ?claw=<id> deep links (e.g., from the dashboard widget) exactly
  // once after the first list load — so refreshes don't fight user navigation
  // once they've moved on.
  const deepLinkAppliedRef = useRef(false);

  const fetchClaws = useCallback(async () => {
    try {
      const [data, recs, stats] = await Promise.all([
        clawsApi.list(pageSize, offset),
        clawsApi.recommendations().catch(() => ({ recommendations: [] })),
        clawsApi.stats().catch(() => ({ needsAttention: 0, llmConcurrency: null })),
      ]);
      setClaws(data.claws);
      setTotalClaws(data.total);
      setRecommendations(recs.recommendations);
      setNeedsAttentionCount(stats.needsAttention ?? 0);
      if (stats.llmConcurrency) setLlmConcurrency(stats.llmConcurrency);
    } catch {
      toast.error('Failed to load claws');
    } finally {
      setIsLoading(false);
    }
  }, [pageSize, offset, toast]);

  const updateLlmConcurrency = async (newMax: number) => {
    try {
      const res = await fetch('/settings/max-llm-concurrency', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxConcurrency: newMax }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.data?.llmConcurrency) {
        setLlmConcurrency(data.data.llmConcurrency);
      } else if (llmConcurrency) {
        setLlmConcurrency({ ...llmConcurrency, max: newMax });
      }
    } catch {
      /* ignore */
    }
  };

  const {
    selectedIds,
    setSelectedIds,
    applyingFixIds,
    isApplyingBatchFixes,
    bulkOp,
    bulkResults,
    startClaw,
    pauseClaw,
    resumeClaw,
    stopClaw,
    deleteClaw,
    approveEscalation,
    denyEscalation,
    cloneClaw,
    applySafeFixes,
    applyTopSafeFixes,
    bulkStop,
    bulkDelete,
    bulkStart,
    bulkPause,
    toggleSelect,
  } = useClawActions({
    claws,
    recommendations,
    refresh: fetchClaws,
    toast,
    confirm,
    selectedClaw,
    setSelectedClaw,
  });

  useEffect(() => {
    fetchClaws();
  }, [fetchClaws]);

  // Keep a ref to the current claws list so the WS handler can resolve names
  // without forcing the subscription effect to re-run on every refresh. Without
  // this, including `claws` in the deps would tear down + re-create all
  // subscriptions on every fetchClaws() call, leaving a window where events
  // could be missed.
  const clawsRef = useRef<ClawConfig[]>([]);
  useEffect(() => {
    clawsRef.current = claws;
  }, [claws]);

  // WS-driven refresh — now using colon-separated WS event names
  useEffect(() => {
    const unsubs = [
      subscribe<{ entity: string }>('data:changed', (p) => {
        if (p.entity === 'claw') fetchClaws();
      }),
      subscribe<{ clawId: string }>('claw:update', () => fetchClaws()),
      subscribe<{ clawId: string }>('claw:started', () => fetchClaws()),
      subscribe<{ clawId: string }>('claw:stopped', () => fetchClaws()),
      subscribe<{ clawId: string; type: string; reason: string }>('claw:escalation', (p) => {
        const claw = clawsRef.current.find((c) => c.id === p.clawId);
        setEscalations((prev) => {
          if (prev.some((e) => e.clawId === p.clawId)) return prev;
          return [
            ...prev,
            {
              clawId: p.clawId,
              name: claw?.name ?? p.clawId,
              type: p.type,
              reason: p.reason,
              requestedAt: new Date().toISOString(),
            },
          ];
        });
      }),
      subscribe<ClawOutputEvent>('claw:output', (evt) => {
        setOutputFeed((prev) => {
          const next = [...prev, evt];
          return next.slice(-100); // keep last 100 events
        });
      }),
      subscribe<{ max: number; active: number; queued: number }>('llm.slot.update', (p) => {
        // Refetch stats to get updated slot labels — stats endpoint resolves agentIds to claw names
        ignoreError(
          clawsApi.stats().then((s) => {
            if (s.llmConcurrency) setLlmConcurrency(s.llmConcurrency);
          }),
          'llm.slot.update'
        );
        // Apply lightweight count update immediately for responsiveness
        setLlmConcurrency((prev) =>
          prev
            ? { ...prev, max: p.max, active: p.active, queued: p.queued }
            : { max: p.max, active: p.active, queued: p.queued, slots: [] }
        );
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, fetchClaws]);

  // Refetch when page changes
  useEffect(() => {
    if (pageTab === 'claws') fetchClaws();
  }, [page]);

  // Deep-link: ?claw=<id> pre-selects that claw and opens the management
  // panel. Runs once after the initial list arrives so refresh cycles don't
  // re-open the panel after the operator dismisses it.
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    if (isLoading || claws.length === 0) return;
    const targetId = searchParams.get('claw');
    if (!targetId) {
      deepLinkAppliedRef.current = true;
      return;
    }
    const target = claws.find((c) => c.id === targetId);
    if (target) {
      setSelectedClaw(target);
      // Honor ?tab=<id> when valid; otherwise land on overview as before.
      const requestedTab = searchParams.get('tab');
      setSelectedDetailTab(isDetailTab(requestedTab) ? requestedTab : 'overview');
      setPageTab('claws');
    } else {
      // Unknown id — drop the stale param so we don't keep trying.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('claw');
          return next;
        },
        { replace: true }
      );
    }
    deepLinkAppliedRef.current = true;
  }, [isLoading, claws, searchParams, setSearchParams]);

  // Detail navigation
  const openClawDetail = (claw: ClawConfig, tab: DetailTab = 'overview') => {
    setSelectedClaw(claw);
    setSelectedDetailTab(tab);
  };

  const filteredClaws = filterClaws(claws, { searchQuery, filterMode, filterState });
  const runningCount = countRunning(claws);
  const { reflectClaws, stalledClaws, failedClaws, operatorQueuedClaws } = deriveAttention(claws);

  return (
    <div className="flex flex-col h-full">
      <AttentionBanners
        escalations={escalations}
        setEscalations={setEscalations}
        approveEscalation={approveEscalation}
        reflectClaws={reflectClaws}
        stalledClaws={stalledClaws}
        failedClaws={failedClaws}
        operatorQueuedClaws={operatorQueuedClaws}
        openClawDetail={openClawDetail}
      />
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
            {needsAttentionCount > 0 && ` \u00B7 ${needsAttentionCount} needs attention`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle — persists per-user in localStorage. */}
          <div
            role="group"
            aria-label="View mode"
            className="hidden sm:inline-flex items-center rounded-lg border border-border dark:border-dark-border overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              title="Grid view"
              className={`p-1.5 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              title="List view"
              className={`p-1.5 transition-colors border-l border-border dark:border-dark-border ${
                viewMode === 'list'
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              <Rows3 className="w-4 h-4" />
            </button>
          </div>
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

      {/* LLM Concurrency Slots Bar — always visible, skeleton while loading */}
      <ConcurrencyBar
        maxSlots={llmConcurrency?.max ?? 3}
        active={llmConcurrency?.active ?? 0}
        queued={llmConcurrency?.queued ?? 0}
        slots={
          llmConcurrency?.slots ??
          Array.from({ length: llmConcurrency?.max ?? 3 }, (_, i) => ({
            slotIdx: i,
            agentId: '',
            label: `Slot ${i + 1}`,
            state: 'free' as const,
          }))
        }
        onIncrease={() => updateLlmConcurrency((llmConcurrency?.max ?? 3) + 1)}
        onDecrease={() => updateLlmConcurrency((llmConcurrency?.max ?? 3) - 1)}
      />

      {/* Live Output Feed — collapsed strip showing real-time claw output */}
      {outputFeed.length > 0 && (
        <div className="border-b border-border dark:border-dark-border bg-[#0d0d0d] max-h-40 overflow-y-auto">
          <div className="flex items-center gap-2 px-6 py-1.5 border-b border-[#1a1a1a]">
            <Terminal className="w-3 h-3 text-gray-500 shrink-0" />
            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider shrink-0">
              Live Output
            </span>
            <span className="text-[10px] font-mono text-gray-600 shrink-0">
              {outputFeed.length} event{outputFeed.length !== 1 ? 's' : ''}
            </span>
            <div className="flex-1 min-w-0">
              {outputFeed.slice(-Math.min(outputFeed.length, 5)).map((evt, i) => {
                const isLatest = i === Math.min(outputFeed.length, 5) - 1;
                return (
                  <div
                    key={i}
                    className={`text-xs font-mono truncate ${isLatest ? 'text-gray-200' : 'text-gray-500'}`}
                  >
                    <span className="text-gray-600 mr-2">{timeAgo(evt.timestamp)}</span>
                    <span className="text-primary mr-1">[{evt.clawId.slice(0, 8)}]</span>
                    {evt.urgency && (
                      <span
                        className={`mr-1 ${
                          evt.urgency === 'urgent'
                            ? 'text-red-400'
                            : evt.urgency === 'high'
                              ? 'text-amber-400'
                              : 'text-gray-500'
                        }`}
                      >
                        [{evt.urgency}]
                      </span>
                    )}
                    {evt.message?.slice(0, 150)}
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setOutputFeed([])}
              className="text-xs text-gray-600 hover:text-gray-400 shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}

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
              {selectedClaw && (
                <div className="animate-fade-in">
                  <ClawManagementPanel
                    claw={claws.find((c) => c.id === selectedClaw.id) ?? selectedClaw}
                    initialTab={selectedDetailTab}
                    onClose={() => setSelectedClaw(null)}
                    onUpdate={fetchClaws}
                  />
                </div>
              )}

              {/* Escalations */}
              {escalations.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-red-700 dark:text-red-300">
                        Pending Escalations
                      </span>
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/20 text-red-600 dark:text-red-300">
                        {escalations.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          for (const esc of escalations) {
                            await approveEscalation(esc.clawId);
                          }
                          setEscalations([]);
                        }}
                        className="px-2 py-1 text-[11px] rounded bg-green-500/10 text-green-600 hover:bg-green-500/20"
                      >
                        Approve All
                      </button>
                      <button
                        onClick={async () => {
                          for (const esc of escalations) {
                            await denyEscalation(esc.clawId);
                          }
                          setEscalations([]);
                        }}
                        className="px-2 py-1 text-[11px] rounded bg-red-500/10 text-red-600 hover:bg-red-500/20"
                      >
                        Deny All
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {escalations.map((esc) => {
                      // Per-type chip color. `task_force_blocked` is the
                      // hard-failsafe at cycle 20 (the task was auto-blocked
                      // and the operator needs to decide whether the mission
                      // can recover) — given the strongest red tone since
                      // dependent tasks may now be orphaned. `task_stalled`
                      // is the softer cycle-10 escalation. `budget_increase`
                      // is amber — different urgency category.
                      const typeChip =
                        esc.type === 'task_force_blocked'
                          ? 'bg-red-600/20 text-red-500 ring-1 ring-red-500/30'
                          : esc.type === 'task_stalled'
                            ? 'bg-red-500/15 text-red-500'
                            : esc.type === 'budget_increase'
                              ? 'bg-amber-500/15 text-amber-500'
                              : 'bg-purple-500/15 text-purple-500';
                      return (
                        <div
                          key={esc.clawId}
                          className="flex items-start justify-between gap-3 p-2 rounded border border-red-500/10 bg-bg-primary dark:bg-dark-bg-primary"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary truncate">
                                {esc.name}
                              </p>
                              <span
                                className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded ${typeChip}`}
                              >
                                {esc.type}
                              </span>
                            </div>
                            <p
                              className="text-[11px] text-text-muted dark:text-dark-text-muted mt-0.5"
                              title={esc.reason}
                            >
                              {esc.reason}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => {
                                approveEscalation(esc.clawId);
                                setEscalations((prev) =>
                                  prev.filter((e) => e.clawId !== esc.clawId)
                                );
                              }}
                              className="px-2 py-1 text-[11px] rounded bg-green-500/10 text-green-600 hover:bg-green-500/20"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => {
                                denyEscalation(esc.clawId);
                                setEscalations((prev) =>
                                  prev.filter((e) => e.clawId !== esc.clawId)
                                );
                              }}
                              className="px-2 py-1 text-[11px] rounded bg-red-500/10 text-red-600 hover:bg-red-500/20"
                            >
                              Deny
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
                              if (target) openClawDetail(target, 'doctor');
                            }}
                            className="px-2 py-1 text-[11px] rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                          >
                            Doctor
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

              <BulkActionsBar
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                bulkOp={bulkOp}
                bulkResults={bulkResults}
                bulkStart={bulkStart}
                bulkPause={bulkPause}
                bulkStop={bulkStop}
                bulkDelete={bulkDelete}
              />

              {/* Claw Grid / List — visual show vs scan-friendly density. */}
              {viewMode === 'grid' ? (
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
                      onDoctor={() => openClawDetail(claw, 'doctor')}
                      onApproveEscalation={() => approveEscalation(claw.id)}
                      onDenyEscalation={() => denyEscalation(claw.id)}
                      onSelect={() => openClawDetail(claw)}
                      isSelected={selectedClaw?.id === claw.id}
                      isChecked={selectedIds.has(claw.id)}
                      onToggleCheck={() => toggleSelect(claw.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredClaws.map((claw) => (
                    <ClawListRow
                      key={claw.id}
                      claw={claw}
                      onStart={() => startClaw(claw.id)}
                      onPause={() => pauseClaw(claw.id)}
                      onResume={() => resumeClaw(claw.id)}
                      onStop={() => stopClaw(claw.id)}
                      onDelete={() => deleteClaw(claw.id, claw.name)}
                      onClone={() => cloneClaw(claw)}
                      onDoctor={() => openClawDetail(claw, 'doctor')}
                      onApproveEscalation={() => approveEscalation(claw.id)}
                      onSelect={() => openClawDetail(claw)}
                      isSelected={selectedClaw?.id === claw.id}
                      isChecked={selectedIds.has(claw.id)}
                      onToggleCheck={() => toggleSelect(claw.id)}
                    />
                  ))}
                </div>
              )}

              {/* Pagination */}
              {totalClaws > pageSize && (
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 text-sm rounded border border-border dark:border-dark-border disabled:opacity-40 hover:bg-bg-tertiary"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-text-muted dark:text-dark-text-muted">
                    Page {page + 1} of {Math.ceil(totalClaws / pageSize)}
                  </span>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * pageSize >= totalClaws}
                    className="px-3 py-1.5 text-sm rounded border border-border dark:border-dark-border disabled:opacity-40 hover:bg-bg-tertiary"
                  >
                    Next
                  </button>
                </div>
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
