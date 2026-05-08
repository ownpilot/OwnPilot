/**
 * AgentsObservabilityPage — Unified observability dashboard for all 6 agent runners
 *
 * Displays real-time stats, health scores, and indicators for:
 * - Subagent: ephemeral single-task executions
 * - Fleet: coordinated multi-worker task execution
 * - Orchestra: multi-step CLI tool chains
 * - Soul: heartbeat-based autonomous agents
 * - Crew: team-based multi-agent orchestration
 * - Claw: unified autonomous runtime
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Bot,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  Layers,
  Zap,
  Users,
  Heart,
  AlertTriangle,
  RefreshCw,
  Link,
} from '../components/icons';
import { apiClient } from '../api';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import {
  subagentsApi,
  fleetApi,
  orchestrationApi,
  soulsApi,
  crewsApi,
  clawsApi,
} from '../api';
import { Skeleton } from '../components/Skeleton';

// ── Shared types (mirrors backend responses) ────────────────────────────────

interface RunnerStats {
  total: number;
  active: number;
  successRate: number;
  avgCost: number;
  avgDuration: number;
  totalCost: number;
  errorRate: number;
  byState: Record<string, number>;
}

interface RunnerHealth {
  status: string;
  score: number;
  signals: string[];
  recommendations: string[];
}

interface SubagentStats extends RunnerStats {
  totalTokens: { input: number; output: number };
  [key: string]: unknown;
}
interface SubagentHealth extends RunnerHealth {}

interface FleetStats {
  totalFleets: number;
  running: number;
  totalWorkers: number;
  successRate: number;
  avgCost: number;
  avgDuration: number;
  totalCost: number;
  errorRate: number;
  byState: Record<string, number>;
  totalTokens: { input: number; output: number };
  tasksCompleted: number;
  tasksFailed: number;
  activeWorkers: number;
  [key: string]: unknown;
}
interface FleetHealth extends RunnerHealth {
  activeFleets: number;
  totalFleets: number;
}

interface OrchestraStats {
  total: number;
  active: number;
  successRate: number;
  avgDuration: number;
  totalCost: number;
  errorRate: number;
  byState: Record<string, number>;
  tasksSucceeded: number;
  tasksFailed: number;
  [key: string]: unknown;
}
interface OrchestraHealth extends RunnerHealth {}

interface SoulStats {
  totalCycles: number;
  totalCost: number;
  avgDurationMs: number;
  failureRate: number;
  [key: string]: unknown;
}
interface SoulHealth extends RunnerHealth {
  totalCycles: number;
  totalCost: number;
  failureRate: number;
}

interface CrewStats {
  totalCrews: number;
  totalCycles: number;
  totalCost: number;
  failureRate: number;
  byStatus: Record<string, number>;
  [key: string]: unknown;
}
interface CrewHealth extends RunnerHealth {
  totalCrews: number;
  pausedCrews: number;
}

interface ClawStats {
  total: number;
  running: number;
  totalCost: number;
  totalCycles: number;
  totalToolCalls: number;
  byMode: Record<string, number>;
  byState: Record<string, number>;
  byHealth: Record<string, number>;
  needsAttention: number;
  [key: string]: unknown;
}
interface ClawHealth extends RunnerHealth {
  activeClaws: number;
  totalClaws: number;
  needsAttention: number;
}

// ── Per-runner card components ───────────────────────────────────────────────

function RunnerCard({
  title,
  icon: Icon,
  iconColor,
  stats,
  health,
  linkTo,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  stats: Record<string, unknown>;
  health: RunnerHealth | null;
  linkTo: string;
}) {
  const statusColors: Record<string, string> = {
    healthy: 'text-success',
    watch: 'text-warning',
    stuck: 'text-orange-500',
    failed: 'text-error',
  };
  const color = health ? statusColors[health.status] ?? 'text-text-muted' : 'text-text-muted';

  return (
    <a
      href={linkTo}
      className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl hover:shadow-md transition-shadow block"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-5 h-5 ${iconColor}`} />
          <h3 className="font-semibold text-sm text-text-primary dark:text-dark-text-primary">
            {title}
          </h3>
        </div>
        {health && (
          <span className={`text-xs font-medium ${color}`}>
            {health.status} ({health.score})
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {Object.entries(stats).slice(0, 4).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-xs text-text-muted dark:text-dark-text-muted capitalize">
              {k.replace(/([A-Z])/g, ' $1').trim()}
            </span>
            <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary">
              {typeof v === 'number' ? (k.includes('Cost') ? `$${v.toFixed(4)}` : k.includes('Rate') || k.includes('Rate') ? `${(v * 100).toFixed(1)}%` : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)) : String(v)}
            </span>
          </div>
        ))}
      </div>
      {health && health.signals.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border dark:border-dark-border">
          {health.signals.slice(0, 2).map((s, i) => (
            <p key={i} className="text-xs text-text-muted dark:text-dark-text-muted truncate">
              · {s}
            </p>
          ))}
        </div>
      )}
    </a>
  );
}

// ── Stat row component for compact display ───────────────────────────────────

function StatRow({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <Icon className={`w-3.5 h-3.5 ${color} flex-shrink-0`} />
      <span className="text-xs text-text-muted dark:text-dark-text-muted flex-1 capitalize">
        {label.replace(/([A-Z])/g, ' $1').trim()}
      </span>
      <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
        {value}
      </span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function AgentsObservabilityPage() {
  const toast = useToast();
  const { subscribe } = useGateway();

  const [subagent, setSubagent] = useState<{ stats: SubagentStats | null; health: SubagentHealth | null }>({ stats: null, health: null });
  const [fleet, setFleet] = useState<{ stats: FleetStats | null; health: FleetHealth | null }>({ stats: null, health: null });
  const [orchestra, setOrchestra] = useState<{ stats: OrchestraStats | null; health: OrchestraHealth | null }>({ stats: null, health: null });
  const [soul, setSoul] = useState<{ stats: SoulStats | null; health: SoulHealth | null }>({ stats: null, health: null });
  const [crew, setCrew] = useState<{ stats: CrewStats | null; health: CrewHealth | null }>({ stats: null, health: null });
  const [claw, setClaw] = useState<{ stats: ClawStats | null; health: ClawHealth | null }>({ stats: null, health: null });

  const [isLoading, setIsLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sa, fl, orc, soulRes, crewRes, clawStatsResult] = await Promise.allSettled([
        Promise.all([subagentsApi.stats(), subagentsApi.health()]),
        Promise.all([fleetApi.stats(), fleetApi.health()]),
        Promise.all([orchestrationApi.stats(), orchestrationApi.health()]),
        Promise.all([soulsApi.stats(), soulsApi.health()]),
        Promise.all([crewsApi.stats(), crewsApi.health()]),
        clawsApi.stats(),
      ]);

      // Fetch claw health separately (not in clawsApi yet)
      let clawHealth: ClawHealth | null = null;
      try {
        clawHealth = await apiClient.get<ClawHealth>('/claws/health');
      } catch { /* not available */ }

      if (sa.status === 'fulfilled') {
        setSubagent({ stats: sa.value[0], health: sa.value[1] });
      }
      if (fl.status === 'fulfilled') {
        setFleet({ stats: fl.value[0], health: fl.value[1] });
      }
      if (orc.status === 'fulfilled') {
        setOrchestra({ stats: orc.value[0], health: orc.value[1] });
      }
      if (soulRes.status === 'fulfilled') {
        setSoul({ stats: soulRes.value[0], health: soulRes.value[1] });
      }
      if (crewRes.status === 'fulfilled') {
        setCrew({ stats: crewRes.value[0], health: crewRes.value[1] });
      }
      if (clawStatsResult.status === 'fulfilled') {
        setClaw({ stats: clawStatsResult.value, health: clawHealth });
      }
    } catch {
      toast.error('Failed to load agent observability data');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // WS-driven refresh
  useEffect(() => {
    const unsubs = [
      subscribe('subagent:completed', loadAll),
      subscribe('subagent:spawned', loadAll),
      subscribe('claw:cycle:completed', loadAll),
      subscribe('orchestra:step:completed', loadAll),
      subscribe('crew:task:completed', loadAll),
      subscribe('soul:heartbeat:completed', loadAll),
      subscribe('fleet:worker:completed', loadAll),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, loadAll]);

  const totalCost =
    (subagent.stats?.totalCost ?? 0) +
    (fleet.stats?.totalCost ?? 0) +
    (orchestra.stats?.totalCost ?? 0) +
    (soul.stats?.totalCost ?? 0) +
    (crew.stats?.totalCost ?? 0) +
    (claw.stats?.totalCost ?? 0);

  const runnerCount = [
    subagent.stats && subagent.stats.total > 0,
    fleet.stats && fleet.stats.totalFleets > 0,
    orchestra.stats && orchestra.stats.total > 0,
    soul.stats && soul.stats.totalCycles > 0,
    crew.stats && crew.stats.totalCrews > 0,
    claw.stats && claw.stats.total > 0,
  ].filter(Boolean).length;

  if (isLoading && !subagent.stats) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Agent Observability
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {runnerCount} active runners ·{' '}
            {totalCost > 0 ? `$${totalCost.toFixed(4)} total cost` : 'no cost recorded'}
          </p>
        </div>
        <button
          onClick={loadAll}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Summary strip */}
        <div className="flex items-center gap-6 px-4 py-3 bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50 rounded-xl border border-border dark:border-dark-border text-xs">
          {subagent.stats && (
            <div className="flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-text-secondary font-medium">{subagent.stats.total.toLocaleString()}</span>
              <span className="text-text-muted">subagent runs</span>
            </div>
          )}
          {fleet.stats && (
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-text-secondary font-medium">{fleet.stats.totalFleets}</span>
              <span className="text-text-muted">fleets</span>
            </div>
          )}
          {orchestra.stats && (
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-text-secondary font-medium">{orchestra.stats.total}</span>
              <span className="text-text-muted">orchestrations</span>
            </div>
          )}
          {soul.stats && (
            <div className="flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-rose-500" />
              <span className="text-text-secondary font-medium">{soul.stats.totalCycles.toLocaleString()}</span>
              <span className="text-text-muted">soul cycles</span>
            </div>
          )}
          {crew.stats && (
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-green-500" />
              <span className="text-text-secondary font-medium">{crew.stats.totalCrews}</span>
              <span className="text-text-muted">crews</span>
            </div>
          )}
          {claw.stats && (
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-text-secondary font-medium">{claw.stats.total}</span>
              <span className="text-text-muted">claws</span>
            </div>
          )}
        </div>

        {/* Runner cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Subagent */}
          <RunnerCard
            title="Subagent"
            icon={Bot}
            iconColor="text-blue-500"
            stats={subagent.stats ?? { total: 0, active: 0, successRate: 0, totalCost: 0 }}
            health={subagent.health}
            linkTo="/subagents"
          />

          {/* Fleet */}
          <RunnerCard
            title="Fleet Command"
            icon={Layers}
            iconColor="text-purple-500"
            stats={fleet.stats ?? { totalFleets: 0, totalWorkers: 0, tasksCompleted: 0, totalCost: 0 }}
            health={fleet.health}
            linkTo="/fleet"
          />

          {/* Orchestra */}
          <RunnerCard
            title="Orchestration"
            icon={Zap}
            iconColor="text-amber-500"
            stats={orchestra.stats ?? { total: 0, active: 0, tasksSucceeded: 0, totalCost: 0 }}
            health={orchestra.health}
            linkTo="/orchestration"
          />

          {/* Soul */}
          <RunnerCard
            title="Soul Agents"
            icon={Heart}
            iconColor="text-rose-500"
            stats={soul.stats ?? { totalCycles: 0, totalCost: 0, avgDurationMs: 0, failureRate: 0 }}
            health={soul.health}
            linkTo="/autonomous"
          />

          {/* Crew */}
          <RunnerCard
            title="Crew Orchestration"
            icon={Users}
            iconColor="text-green-500"
            stats={crew.stats ?? { totalCrews: 0, totalCycles: 0, totalCost: 0, failureRate: 0 }}
            health={crew.health}
            linkTo="/autonomous?tab=crews"
          />

          {/* Claw */}
          <RunnerCard
            title="Claw Runtime"
            icon={Zap}
            iconColor="text-orange-500"
            stats={claw.stats ?? { total: 0, running: 0, totalCost: 0, totalCycles: 0 }}
            health={claw.health}
            linkTo="/claws"
          />
        </div>

        {/* Detailed breakdown */}
        {(subagent.stats || fleet.stats || orchestra.stats || soul.stats || crew.stats || claw.stats) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Subagent details */}
            {subagent.stats && (
              <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                  <Bot className="w-4 h-4 text-blue-500" />
                  <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                    Subagent Detail
                  </h3>
                </div>
                <div className="space-y-1">
                  <StatRow label="Total Runs" value={subagent.stats.total.toLocaleString()} icon={Bot} color="text-blue-500" />
                  <StatRow label="Active" value={subagent.stats.active.toString()} icon={Activity} color="text-green-500" />
                  <StatRow label="Success Rate" value={`${(subagent.stats.successRate * 100).toFixed(1)}%`} icon={CheckCircle2} color="text-emerald-500" />
                  <StatRow label="Error Rate" value={`${(subagent.stats.errorRate * 100).toFixed(1)}%`} icon={XCircle} color="text-red-500" />
                  <StatRow label="Avg Cost" value={`$${subagent.stats.avgCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
                  <StatRow label="Avg Duration" value={`${subagent.stats.avgDuration.toFixed(0)}ms`} icon={Clock} color="text-purple-500" />
                  <StatRow label="Total Cost" value={`$${subagent.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-indigo-500" />
                  <StatRow label="Input Tokens" value={`${(subagent.stats.totalTokens.input / 1000).toFixed(1)}K`} icon={Activity} color="text-cyan-500" />
                  <StatRow label="Output Tokens" value={`${(subagent.stats.totalTokens.output / 1000).toFixed(1)}K`} icon={Activity} color="text-cyan-500" />
                </div>
              </div>
            )}

            {/* Fleet details */}
            {fleet.stats && (
              <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="w-4 h-4 text-purple-500" />
                  <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                    Fleet Detail
                  </h3>
                </div>
                <div className="space-y-1">
                  <StatRow label="Total Fleets" value={fleet.stats.totalFleets.toString()} icon={Layers} color="text-purple-500" />
                  <StatRow label="Running" value={fleet.stats.running.toString()} icon={Activity} color="text-green-500" />
                  <StatRow label="Total Workers" value={fleet.stats.totalWorkers.toString()} icon={Users} color="text-blue-500" />
                  <StatRow label="Active Workers" value={fleet.stats.activeWorkers.toString()} icon={Activity} color="text-green-500" />
                  <StatRow label="Tasks Completed" value={fleet.stats.tasksCompleted.toLocaleString()} icon={CheckCircle2} color="text-emerald-500" />
                  <StatRow label="Tasks Failed" value={fleet.stats.tasksFailed.toLocaleString()} icon={XCircle} color="text-red-500" />
                  <StatRow label="Success Rate" value={`${(fleet.stats.successRate * 100).toFixed(1)}%`} icon={CheckCircle2} color="text-emerald-500" />
                  <StatRow label="Total Cost" value={`$${fleet.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
                </div>
              </div>
            )}

            {/* Orchestra details */}
            {orchestra.stats && (
              <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                    Orchestration Detail
                  </h3>
                </div>
                <div className="space-y-1">
                  <StatRow label="Total Runs" value={orchestra.stats.total.toString()} icon={Zap} color="text-amber-500" />
                  <StatRow label="Active" value={orchestra.stats.active.toString()} icon={Activity} color="text-green-500" />
                  <StatRow label="Tasks Succeeded" value={orchestra.stats.tasksSucceeded.toLocaleString()} icon={CheckCircle2} color="text-emerald-500" />
                  <StatRow label="Tasks Failed" value={orchestra.stats.tasksFailed.toLocaleString()} icon={XCircle} color="text-red-500" />
                  <StatRow label="Success Rate" value={`${(orchestra.stats.successRate * 100).toFixed(1)}%`} icon={CheckCircle2} color="text-emerald-500" />
                  <StatRow label="Avg Duration" value={`${(orchestra.stats.avgDuration / 1000).toFixed(1)}s`} icon={Clock} color="text-purple-500" />
                  <StatRow label="Total Cost" value={`$${orchestra.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
                </div>
              </div>
            )}

            {/* Soul details */}
            {soul.stats && (
              <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                  <Heart className="w-4 h-4 text-rose-500" />
                  <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                    Soul Agents Detail
                  </h3>
                </div>
                <div className="space-y-1">
                  <StatRow label="Total Cycles" value={soul.stats.totalCycles.toLocaleString()} icon={Heart} color="text-rose-500" />
                  <StatRow label="Total Cost" value={`$${soul.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
                  <StatRow label="Avg Duration" value={`${(soul.stats.avgDurationMs / 1000).toFixed(1)}s`} icon={Clock} color="text-purple-500" />
                  <StatRow label="Failure Rate" value={`${(soul.stats.failureRate * 100).toFixed(1)}%`} icon={AlertTriangle} color={soul.stats.failureRate > 0.2 ? 'text-red-500' : 'text-emerald-500'} />
                </div>
              </div>
            )}

            {/* Crew details */}
            {crew.stats && (
              <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-green-500" />
                  <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                    Crew Detail
                  </h3>
                </div>
                <div className="space-y-1">
                  <StatRow label="Total Crews" value={crew.stats.totalCrews.toString()} icon={Users} color="text-green-500" />
                  <StatRow label="Total Cycles" value={crew.stats.totalCycles.toLocaleString()} icon={Activity} color="text-blue-500" />
                  <StatRow label="Total Cost" value={`$${crew.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
                  <StatRow label="Failure Rate" value={`${(crew.stats.failureRate * 100).toFixed(1)}%`} icon={AlertTriangle} color={crew.stats.failureRate > 0.2 ? 'text-red-500' : 'text-emerald-500'} />
                </div>
              </div>
            )}

            {/* Claw details */}
            {claw.stats && (
              <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-orange-500" />
                  <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                    Claw Detail
                  </h3>
                </div>
                <div className="space-y-1">
                  <StatRow label="Total Claws" value={claw.stats.total.toString()} icon={Zap} color="text-orange-500" />
                  <StatRow label="Running" value={claw.stats.running.toString()} icon={Activity} color="text-green-500" />
                  <StatRow label="Total Cycles" value={claw.stats.totalCycles.toLocaleString()} icon={Activity} color="text-blue-500" />
                  <StatRow label="Total Tool Calls" value={claw.stats.totalToolCalls.toLocaleString()} icon={Link} color="text-purple-500" />
                  <StatRow label="Total Cost" value={`$${claw.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
                  <StatRow label="Needs Attention" value={claw.stats.needsAttention.toString()} icon={AlertTriangle} color={claw.stats.needsAttention > 0 ? 'text-orange-500' : 'text-emerald-500'} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Health recommendations */}
        {[subagent.health, fleet.health, orchestra.health, soul.health, crew.health, claw.health]
          .filter((h) => h && h.recommendations.length > 0)
          .map((h, i) => (
            <div
              key={i}
              className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl"
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-warning" />
                <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                  Recommendations
                </h3>
              </div>
              <ul className="space-y-1">
                {h!.recommendations.map((r, j) => (
                  <li key={j} className="text-xs text-text-muted dark:text-dark-text-muted flex items-start gap-2">
                    <span className="text-warning mt-0.5">·</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </div>
  );
}