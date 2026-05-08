/**
 * AgentsObservabilityPage — Tabbed observability dashboard for all 6 agent runners
 *
 * Tab structure:
 * - Home: unified overview of all runners
 * - Subagent / Fleet / Orchestra / Soul / Crew / Claw: per-runner drill-down
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
  Home,
  ChevronRight,
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
import type { SubagentHistoryEntry } from '../api/endpoints/subagents';
import type { HeartbeatLog } from '../api/endpoints/souls';
import { heartbeatLogsApi } from '../api';

// ── Shared types ───────────────────────────────────────────────────────────────

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
  avgCost?: number;
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

// ── Tab definitions ───────────────────────────────────────────────────────────

type TabId = 'home' | 'subagent' | 'fleet' | 'orchestra' | 'soul' | 'crew' | 'claw';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'subagent', label: 'Subagent', icon: Bot },
  { id: 'fleet', label: 'Fleet', icon: Layers },
  { id: 'orchestra', label: 'Orchestra', icon: Zap },
  { id: 'soul', label: 'Soul', icon: Heart },
  { id: 'crew', label: 'Crew', icon: Users },
  { id: 'claw', label: 'Claw', icon: Zap },
];

// ── Stat row component ─────────────────────────────────────────────────────────

function StatRow({ label, value, icon: Icon, color }: {
  label: string; value: string | number; icon: React.ElementType; color: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <Icon className={`w-3.5 h-3.5 ${color} flex-shrink-0`} />
      <span className="text-xs text-text-muted dark:text-dark-text-muted flex-1 capitalize">
        {label.replace(/([A-Z])/g, ' $1').trim()}
      </span>
      <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary">{value}</span>
    </div>
  );
}

// ── Runner card component (used in Home tab) ────────────────────────────────────

function RunnerCard({
  title, icon: Icon, iconColor, stats, health, onClick,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  stats: Record<string, unknown>;
  health: RunnerHealth | null;
  onClick: () => void;
}) {
  const statusColors: Record<string, string> = {
    healthy: 'text-success', watch: 'text-warning', stuck: 'text-orange-500', failed: 'text-error',
  };
  const color = health ? statusColors[health.status] ?? 'text-text-muted' : 'text-text-muted';

  return (
    <button
      onClick={onClick}
      className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl hover:shadow-md transition-shadow text-left w-full"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-5 h-5 ${iconColor}`} />
          <h3 className="font-semibold text-sm text-text-primary dark:text-dark-text-primary">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {health && <span className={`text-xs font-medium ${color}`}>{health.status} ({health.score})</span>}
          <ChevronRight className="w-4 h-4 text-text-muted" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {Object.entries(stats).slice(0, 4).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-xs text-text-muted dark:text-dark-text-muted capitalize">
              {k.replace(/([A-Z])/g, ' $1').trim()}
            </span>
            <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary">
              {typeof v === 'number'
                ? k.includes('Cost') ? `$${v.toFixed(4)}`
                : k.includes('Rate') ? `${(v * 100).toFixed(1)}%`
                : Number.isInteger(v) ? v.toLocaleString()
                : v.toFixed(2)
                : String(v)}
            </span>
          </div>
        ))}
      </div>
      {health && health.signals.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border dark:border-dark-border">
          {health.signals.slice(0, 2).map((s, i) => (
            <p key={i} className="text-xs text-text-muted dark:text-dark-text-muted truncate">· {s}</p>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Inline stats card ──────────────────────────────────────────────────────────

function StatsCard({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-card border border-border dark:border-dark-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-muted">{label}</span>
      </div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

// ── Home tab ──────────────────────────────────────────────────────────────────

function HomeTab({
  subagent, fleet, orchestra, soul, crew, claw,
  onSelectTab,
}: {
  subagent: { stats: SubagentStats | null; health: SubagentHealth | null };
  fleet: { stats: FleetStats | null; health: FleetHealth | null };
  orchestra: { stats: OrchestraStats | null; health: OrchestraHealth | null };
  soul: { stats: SoulStats | null; health: SoulHealth | null };
  crew: { stats: CrewStats | null; health: CrewHealth | null };
  claw: { stats: ClawStats | null; health: ClawHealth | null };
  onSelectTab: (tab: TabId) => void;
}) {
  const totalCost =
    (subagent.stats?.totalCost ?? 0) + (fleet.stats?.totalCost ?? 0) +
    (orchestra.stats?.totalCost ?? 0) + (soul.stats?.totalCost ?? 0) +
    (crew.stats?.totalCost ?? 0) + (claw.stats?.totalCost ?? 0);

  return (
    <div className="space-y-6">
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
        {totalCost > 0 && (
          <span className="ml-auto text-text-muted">
            Total cost: <span className="font-medium text-text-secondary">${totalCost.toFixed(4)}</span>
          </span>
        )}
      </div>

      {/* Runner cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <RunnerCard title="Subagent" icon={Bot} iconColor="text-blue-500"
          stats={subagent.stats ?? { total: 0, active: 0, successRate: 0, totalCost: 0 }}
          health={subagent.health} onClick={() => onSelectTab('subagent')} />
        <RunnerCard title="Fleet Command" icon={Layers} iconColor="text-purple-500"
          stats={fleet.stats ?? { totalFleets: 0, totalWorkers: 0, tasksCompleted: 0, totalCost: 0 }}
          health={fleet.health} onClick={() => onSelectTab('fleet')} />
        <RunnerCard title="Orchestration" icon={Zap} iconColor="text-amber-500"
          stats={orchestra.stats ?? { total: 0, active: 0, tasksSucceeded: 0, totalCost: 0 }}
          health={orchestra.health} onClick={() => onSelectTab('orchestra')} />
        <RunnerCard title="Soul Agents" icon={Heart} iconColor="text-rose-500"
          stats={soul.stats ?? { totalCycles: 0, totalCost: 0, avgDurationMs: 0, failureRate: 0 }}
          health={soul.health} onClick={() => onSelectTab('soul')} />
        <RunnerCard title="Crew Orchestration" icon={Users} iconColor="text-green-500"
          stats={crew.stats ?? { totalCrews: 0, totalCycles: 0, totalCost: 0, failureRate: 0 }}
          health={crew.health} onClick={() => onSelectTab('crew')} />
        <RunnerCard title="Claw Runtime" icon={Zap} iconColor="text-orange-500"
          stats={claw.stats ?? { total: 0, running: 0, totalCost: 0, totalCycles: 0 }}
          health={claw.health} onClick={() => onSelectTab('claw')} />
      </div>

      {/* Detail panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {subagent.stats && (
          <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Bot className="w-4 h-4 text-blue-500" />
              <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">Subagent</h3>
            </div>
            <div className="space-y-1">
              <StatRow label="Total Runs" value={subagent.stats.total.toLocaleString()} icon={Bot} color="text-blue-500" />
              <StatRow label="Success Rate" value={`${(subagent.stats.successRate * 100).toFixed(1)}%`} icon={CheckCircle2} color="text-emerald-500" />
              <StatRow label="Avg Cost" value={`$${subagent.stats.avgCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
              <StatRow label="Total Cost" value={`$${subagent.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-indigo-500" />
            </div>
          </div>
        )}
        {fleet.stats && (
          <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-purple-500" />
              <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">Fleet</h3>
            </div>
            <div className="space-y-1">
              <StatRow label="Total Fleets" value={fleet.stats.totalFleets.toString()} icon={Layers} color="text-purple-500" />
              <StatRow label="Running" value={fleet.stats.running.toString()} icon={Activity} color="text-green-500" />
              <StatRow label="Tasks Completed" value={fleet.stats.tasksCompleted.toLocaleString()} icon={CheckCircle2} color="text-emerald-500" />
              <StatRow label="Total Cost" value={`$${fleet.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
            </div>
          </div>
        )}
        {orchestra.stats && (
          <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">Orchestration</h3>
            </div>
            <div className="space-y-1">
              <StatRow label="Total Runs" value={orchestra.stats.total.toString()} icon={Zap} color="text-amber-500" />
              <StatRow label="Tasks Succeeded" value={orchestra.stats.tasksSucceeded.toLocaleString()} icon={CheckCircle2} color="text-emerald-500" />
              <StatRow label="Success Rate" value={`${(orchestra.stats.successRate * 100).toFixed(1)}%`} icon={CheckCircle2} color="text-emerald-500" />
              <StatRow label="Total Cost" value={`$${orchestra.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
            </div>
          </div>
        )}
        {soul.stats && (
          <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Heart className="w-4 h-4 text-rose-500" />
              <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">Soul Agents</h3>
            </div>
            <div className="space-y-1">
              <StatRow label="Total Cycles" value={soul.stats.totalCycles.toLocaleString()} icon={Heart} color="text-rose-500" />
              <StatRow label="Total Cost" value={`$${soul.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
              <StatRow label="Failure Rate" value={`${(soul.stats.failureRate * 100).toFixed(1)}%`} icon={AlertTriangle} color={soul.stats.failureRate > 0.2 ? 'text-red-500' : 'text-emerald-500'} />
            </div>
          </div>
        )}
        {crew.stats && (
          <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-green-500" />
              <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">Crew</h3>
            </div>
            <div className="space-y-1">
              <StatRow label="Total Crews" value={crew.stats.totalCrews.toString()} icon={Users} color="text-green-500" />
              <StatRow label="Total Cycles" value={crew.stats.totalCycles.toLocaleString()} icon={Activity} color="text-blue-500" />
              <StatRow label="Total Cost" value={`$${crew.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
            </div>
          </div>
        )}
        {claw.stats && (
          <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-orange-500" />
              <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">Claw</h3>
            </div>
            <div className="space-y-1">
              <StatRow label="Total Claws" value={claw.stats.total.toString()} icon={Zap} color="text-orange-500" />
              <StatRow label="Running" value={claw.stats.running.toString()} icon={Activity} color="text-green-500" />
              <StatRow label="Total Cycles" value={claw.stats.totalCycles.toLocaleString()} icon={Activity} color="text-blue-500" />
              <StatRow label="Total Cost" value={`$${claw.stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subagent tab ───────────────────────────────────────────────────────────────

function SubagentTab({ stats, health }: { stats: SubagentStats | null; health: SubagentHealth | null }) {
  const [history, setHistory] = useState<SubagentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    subagentsApi.getHistory(undefined, 50, 0)
      .then((d) => setHistory(d.entries))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const healthColor = health?.status === 'healthy' ? 'text-green-500' :
    health?.status === 'watch' ? 'text-yellow-500' : 'text-red-500';

  return (
    <div className="space-y-6">
      {/* Health badge */}
      {health && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${healthColor} bg-opacity-20 w-fit`}>
          {health.status} (score: {health.score})
          {health.signals.length > 0 && ` · ${health.signals.join(', ')}`}
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatsCard label="Total Runs" value={stats.total.toLocaleString()} icon={Bot} color="text-blue-500" />
          <StatsCard label="Success Rate" value={`${(stats.successRate * 100).toFixed(1)}%`} icon={CheckCircle2} color="text-emerald-500" />
          <StatsCard label="Avg Cost" value={`$${stats.avgCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
          <StatsCard label="Total Cost" value={`$${stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-indigo-500" />
          <StatsCard label="Avg Duration" value={`${(stats.avgDuration / 1000).toFixed(1)}s`} icon={Clock} color="text-purple-500" />
          <StatsCard label="Error Rate" value={`${(stats.errorRate * 100).toFixed(1)}%`} icon={XCircle} color="text-red-500" />
          <StatsCard label="Input Tokens" value={`${(stats.totalTokens.input / 1000).toFixed(1)}K`} icon={Activity} color="text-cyan-500" />
          <StatsCard label="Output Tokens" value={`${(stats.totalTokens.output / 1000).toFixed(1)}K`} icon={Activity} color="text-cyan-500" />
        </div>
      )}

      {/* Recommendations */}
      {health && health.recommendations.length > 0 && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <h3 className="text-sm font-medium text-yellow-500 mb-2">Recommendations</h3>
          <ul className="space-y-1">
            {health.recommendations.map((r, i) => <li key={i} className="text-xs text-yellow-400">→ {r}</li>)}
          </ul>
        </div>
      )}

      {/* Recent executions */}
      <div>
        <h3 className="text-sm font-medium mb-3">Recent Executions</h3>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">No subagent executions yet</div>
        ) : (
          <div className="space-y-2">
            {history.map((s) => (
              <div key={s.id} className="bg-card border border-border dark:border-dark-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Bot className="w-4 h-4 text-accent" />
                    <div>
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className="text-xs text-muted">{s.task?.slice(0, 80)}{s.task && s.task.length > 80 ? '...' : ''}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s.state === 'completed' ? 'bg-green-500/20 text-green-400' :
                      s.state === 'failed' ? 'bg-red-500/20 text-red-400' :
                      s.state === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                      s.state === 'running' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>{s.state}</span>
                    {s.durationMs != null && <span className="text-xs text-muted">{s.durationMs}ms</span>}
                  </div>
                </div>
                {s.error && <div className="mt-2 text-xs text-error bg-error/10 rounded px-2 py-1">{s.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Fleet tab ─────────────────────────────────────────────────────────────────

function FleetTab({ stats, health }: { stats: FleetStats | null; health: FleetHealth | null }) {
  return (
    <div className="space-y-6">
      {health && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium w-fit ${
          health.status === 'healthy' ? 'text-green-500' :
          health.status === 'watch' ? 'text-yellow-500' :
          health.status === 'expensive' ? 'text-orange-500' :
          'text-red-500'
        } bg-opacity-20`}>
          {health.status} (score: {health.score})
          {health.signals.length > 0 && ` · ${health.signals.join(', ')}`}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatsCard label="Total Fleets" value={stats.totalFleets.toString()} icon={Layers} color="text-purple-500" />
          <StatsCard label="Running" value={stats.running.toString()} icon={Activity} color="text-green-500" />
          <StatsCard label="Total Workers" value={stats.totalWorkers.toString()} icon={Users} color="text-blue-500" />
          <StatsCard label="Tasks Completed" value={stats.tasksCompleted.toLocaleString()} icon={CheckCircle2} color="text-emerald-500" />
          <StatsCard label="Tasks Failed" value={stats.tasksFailed.toLocaleString()} icon={XCircle} color="text-red-500" />
          <StatsCard label="Success Rate" value={`${(stats.successRate * 100).toFixed(1)}%`} icon={CheckCircle2} color="text-emerald-500" />
          <StatsCard label="Avg Cost" value={`$${stats.avgCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
          <StatsCard label="Total Cost" value={`$${stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-indigo-500" />
        </div>
      )}

      {health && health.recommendations.length > 0 && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <h3 className="text-sm font-medium text-yellow-500 mb-2">Recommendations</h3>
          <ul className="space-y-1">
            {health.recommendations.map((r, i) => <li key={i} className="text-xs text-yellow-400">→ {r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Orchestra tab ─────────────────────────────────────────────────────────────

function OrchestraTab({ stats, health }: { stats: OrchestraStats | null; health: OrchestraHealth | null }) {
  return (
    <div className="space-y-6">
      {health && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium w-fit ${
          health.status === 'healthy' ? 'text-green-500' :
          health.status === 'watch' ? 'text-yellow-500' : 'text-red-500'
        } bg-opacity-20`}>
          {health.status} (score: {health.score})
          {health.signals.length > 0 && ` · ${health.signals.join(', ')}`}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatsCard label="Total Runs" value={stats.total.toString()} icon={Zap} color="text-amber-500" />
          <StatsCard label="Active" value={stats.active.toString()} icon={Activity} color="text-green-500" />
          <StatsCard label="Tasks Succeeded" value={stats.tasksSucceeded.toLocaleString()} icon={CheckCircle2} color="text-emerald-500" />
          <StatsCard label="Tasks Failed" value={stats.tasksFailed.toLocaleString()} icon={XCircle} color="text-red-500" />
          <StatsCard label="Success Rate" value={`${(stats.successRate * 100).toFixed(1)}%`} icon={CheckCircle2} color="text-emerald-500" />
          <StatsCard label="Avg Duration" value={`${(stats.avgDuration / 1000).toFixed(1)}s`} icon={Clock} color="text-purple-500" />
          <StatsCard label="Total Cost" value={`$${stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-indigo-500" />
        </div>
      )}

      {health && health.recommendations.length > 0 && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <h3 className="text-sm font-medium text-yellow-500 mb-2">Recommendations</h3>
          <ul className="space-y-1">
            {health.recommendations.map((r, i) => <li key={i} className="text-xs text-yellow-400">→ {r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Soul tab ───────────────────────────────────────────────────────────────────

function SoulTab({ stats, health }: { stats: SoulStats | null; health: SoulHealth | null }) {
  const [heartbeats, setHeartbeats] = useState<HeartbeatLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    heartbeatLogsApi.list(50, 0)
      .then((d) => setHeartbeats(d.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {health && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium w-fit ${
          health.status === 'healthy' ? 'text-green-500' :
          health.status === 'watch' ? 'text-yellow-500' : 'text-red-500'
        } bg-opacity-20`}>
          {health.status} (score: {health.score})
          {health.signals.length > 0 && ` · ${health.signals.join(', ')}`}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatsCard label="Total Cycles" value={stats.totalCycles.toLocaleString()} icon={Heart} color="text-rose-500" />
          <StatsCard label="Total Cost" value={`$${stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
          <StatsCard label="Avg Duration" value={`${(stats.avgDurationMs / 1000).toFixed(1)}s`} icon={Clock} color="text-purple-500" />
          <StatsCard label="Failure Rate" value={`${(stats.failureRate * 100).toFixed(1)}%`} icon={AlertTriangle} color={stats.failureRate > 0.2 ? 'text-red-500' : 'text-emerald-500'} />
        </div>
      )}

      {health && health.recommendations.length > 0 && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <h3 className="text-sm font-medium text-yellow-500 mb-2">Recommendations</h3>
          <ul className="space-y-1">
            {health.recommendations.map((r, i) => <li key={i} className="text-xs text-yellow-400">→ {r}</li>)}
          </ul>
        </div>
      )}

      {/* Recent heartbeats */}
      <div>
        <h3 className="text-sm font-medium mb-3">Recent Heartbeats</h3>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : heartbeats.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">No heartbeat logs yet</div>
        ) : (
          <div className="space-y-2">
            {heartbeats.map((hb) => (
              <div key={hb.id} className="bg-card border border-border dark:border-dark-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Heart className="w-4 h-4 text-rose-500" />
                    <div>
                      <div className="text-sm font-medium">{hb.agentId.slice(0, 12)}...</div>
                      <div className="text-xs text-muted">
                        {hb.tasksRun.length} tasks · {hb.durationMs}ms
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {hb.tasksFailed.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                        {hb.tasksFailed.length} failed
                      </span>
                    )}
                    <span className="text-xs text-muted">${hb.cost.toFixed(4)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Crew tab ───────────────────────────────────────────────────────────────────

function CrewTab({ stats, health }: { stats: CrewStats | null; health: CrewHealth | null }) {
  return (
    <div className="space-y-6">
      {health && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium w-fit ${
          health.status === 'healthy' ? 'text-green-500' : 'text-yellow-500'
        } bg-opacity-20`}>
          {health.status} (score: {health.score})
          {health.signals.length > 0 && ` · ${health.signals.join(', ')}`}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatsCard label="Total Crews" value={stats.totalCrews.toString()} icon={Users} color="text-green-500" />
          <StatsCard label="Total Cycles" value={stats.totalCycles.toLocaleString()} icon={Activity} color="text-blue-500" />
          <StatsCard label="Total Cost" value={`$${stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
          <StatsCard label="Failure Rate" value={`${(stats.failureRate * 100).toFixed(1)}%`} icon={AlertTriangle} color={stats.failureRate > 0.2 ? 'text-red-500' : 'text-emerald-500'} />
        </div>
      )}

      {/* Crews by status */}
      {stats && Object.keys(stats.byStatus).length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3">Crews by Status</h3>
          <div className="flex gap-3">
            {Object.entries(stats.byStatus).map(([status, count]) => (
              <div key={status} className="bg-card border border-border dark:border-dark-border rounded-lg px-4 py-2">
                <div className="text-xl font-semibold">{count}</div>
                <div className="text-xs text-muted capitalize">{status}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {health && health.recommendations.length > 0 && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <h3 className="text-sm font-medium text-yellow-500 mb-2">Recommendations</h3>
          <ul className="space-y-1">
            {health.recommendations.map((r, i) => <li key={i} className="text-xs text-yellow-400">→ {r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Claw tab ───────────────────────────────────────────────────────────────────

interface ClawListItem {
  id: string;
  name: string;
  mode: string;
  state: string;
  totalCostUsd: number;
  cyclesCompleted: number;
  lastCycleError: string | null;
}

function ClawTab({ stats, health }: { stats: ClawStats | null; health: ClawHealth | null }) {
  const [claws, setClaws] = useState<ClawListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    clawsApi.list(50, 0)
      .then((d) => setClaws(d.claws.map((c) => ({
        id: c.id,
        name: c.name ?? c.id,
        mode: c.mode ?? 'unknown',
        state: c.session?.state ?? 'stopped',
        totalCostUsd: c.session?.totalCostUsd ?? 0,
        cyclesCompleted: c.session?.cyclesCompleted ?? 0,
        lastCycleError: c.session?.lastCycleError ?? null,
      }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {health && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium w-fit ${
          health.status === 'healthy' ? 'text-green-500' :
          health.status === 'watch' ? 'text-yellow-500' :
          health.status === 'expensive' ? 'text-orange-500' : 'text-red-500'
        } bg-opacity-20`}>
          {health.status} (score: {health.score})
          {health.signals.length > 0 && ` · ${health.signals.join(', ')}`}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatsCard label="Total Claws" value={stats.total.toString()} icon={Zap} color="text-orange-500" />
          <StatsCard label="Running" value={stats.running.toString()} icon={Activity} color="text-green-500" />
          <StatsCard label="Total Cycles" value={stats.totalCycles.toLocaleString()} icon={Activity} color="text-blue-500" />
          <StatsCard label="Total Cost" value={`$${stats.totalCost.toFixed(4)}`} icon={DollarSign} color="text-amber-500" />
          <StatsCard label="Total Tool Calls" value={stats.totalToolCalls.toLocaleString()} icon={Link} color="text-purple-500" />
          <StatsCard label="Needs Attention" value={stats.needsAttention.toString()} icon={AlertTriangle} color={stats.needsAttention > 0 ? 'text-orange-500' : 'text-emerald-500'} />
          <StatsCard label="Avg Cost" value={`$${(stats.totalCost / Math.max(stats.totalCycles, 1)).toFixed(4)}`} icon={DollarSign} color="text-indigo-500" />
        </div>
      )}

      {/* Mode distribution */}
      {stats && Object.keys(stats.byMode).length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3">By Mode</h3>
          <div className="flex gap-3">
            {Object.entries(stats.byMode).map(([mode, count]) => (
              <div key={mode} className="bg-card border border-border dark:border-dark-border rounded-lg px-4 py-2">
                <div className="text-xl font-semibold">{count}</div>
                <div className="text-xs text-muted capitalize">{mode}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {health && health.recommendations.length > 0 && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <h3 className="text-sm font-medium text-yellow-500 mb-2">Recommendations</h3>
          <ul className="space-y-1">
            {health.recommendations.map((r, i) => <li key={i} className="text-xs text-yellow-400">→ {r}</li>)}
          </ul>
        </div>
      )}

      {/* Claw list */}
      <div>
        <h3 className="text-sm font-medium mb-3">Claw Configurations</h3>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : claws.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">No claws configured</div>
        ) : (
          <div className="space-y-2">
            {claws.map((claw) => (
              <div key={claw.id} className="bg-card border border-border dark:border-dark-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Zap className="w-4 h-4 text-orange-500" />
                    <div>
                      <div className="text-sm font-medium">{claw.name}</div>
                      <div className="text-xs text-muted">{claw.mode} · {claw.cyclesCompleted} cycles</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      claw.state === 'running' ? 'bg-green-500/20 text-green-400' :
                      claw.state === 'failed' ? 'bg-red-500/20 text-red-400' :
                      claw.state === 'paused' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>{claw.state}</span>
                    <span className="text-xs text-muted">${claw.totalCostUsd.toFixed(4)}</span>
                  </div>
                </div>
                {claw.lastCycleError && (
                  <div className="mt-2 text-xs text-error bg-error/10 rounded px-2 py-1">
                    Last error: {claw.lastCycleError}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function AgentsObservabilityPage() {
  const toast = useToast();
  const { subscribe } = useGateway();

  const [activeTab, setActiveTab] = useState<TabId>('home');

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

      let clawHealth: ClawHealth | null = null;
      try { clawHealth = await apiClient.get<ClawHealth>('/claws/health'); } catch { /* not available */ }

      if (sa.status === 'fulfilled') setSubagent({ stats: sa.value[0], health: sa.value[1] });
      if (fl.status === 'fulfilled') setFleet({ stats: fl.value[0], health: fl.value[1] });
      if (orc.status === 'fulfilled') setOrchestra({ stats: orc.value[0], health: orc.value[1] });
      if (soulRes.status === 'fulfilled') setSoul({ stats: soulRes.value[0], health: soulRes.value[1] });
      if (crewRes.status === 'fulfilled') setCrew({ stats: crewRes.value[0], health: crewRes.value[1] });
      if (clawStatsResult.status === 'fulfilled') setClaw({ stats: clawStatsResult.value, health: clawHealth });
    } catch {
      toast.error('Failed to load agent observability data');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">Agent Observability</h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {TABS.filter((t) => t.id !== 'home').length} runners · real-time monitoring
          </p>
        </div>
        <button onClick={loadAll} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'home' && (
          <HomeTab
            subagent={subagent} fleet={fleet} orchestra={orchestra}
            soul={soul} crew={crew} claw={claw}
            onSelectTab={setActiveTab}
          />
        )}
        {activeTab === 'subagent' && <SubagentTab stats={subagent.stats} health={subagent.health} />}
        {activeTab === 'fleet' && <FleetTab stats={fleet.stats} health={fleet.health} />}
        {activeTab === 'orchestra' && <OrchestraTab stats={orchestra.stats} health={orchestra.health} />}
        {activeTab === 'soul' && <SoulTab stats={soul.stats} health={soul.health} />}
        {activeTab === 'crew' && <CrewTab stats={crew.stats} health={crew.health} />}
        {activeTab === 'claw' && <ClawTab stats={claw.stats} health={claw.health} />}
      </div>
    </div>
  );
}